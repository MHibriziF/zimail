import { eventInterval } from '../../calendar/events';
import { dateKeyIn, startOfDayIn } from '../../calendar/grid';
import {
	guestChangeBlock,
	MAX_GUEST_RESCHEDULES,
	MAX_PAGES_PER_USER,
	SLOT_DAYS_PER_REQUEST,
	slugify,
	validateGuest,
	validatePageSettings,
	type GuestChangeBlock,
	type ManagedBookingView,
	type PublicReservationPage,
	type ReservationPage,
	type ReservationPageError,
	type ReservationPageSettings
} from '../../calendar/reservations';
import { computeSlots, isFreeSlot, type DaySlots, type Interval } from '../../calendar/slots';
import type { CalendarRepository } from '../calendar/repository';
import type { BookingDetails, InviteKind } from './email';
import type { RoomSettings } from '../../meet/room-settings';
import type { ManagedBooking, ReservationsRepository, StoredBooking, StoredPage } from './repository';
import { createLinkToken, hashToken } from '../util/crypto';

const DAY_MS = 86_400_000;
/** A page takes at most this many bookings a day, and one guest address this many upcoming ones. */
export const MAX_BOOKINGS_PER_DAY = 30;
export const MAX_UPCOMING_PER_GUEST = 3;
/**
 * How long a booking waits for the host's calendars to refresh before it is
 * checked against what is stored. A slow or unreachable calendar server never
 * blocks a booking; the refresh still finishes in the background.
 */
export const BOOKING_REFRESH_WAIT_MS = 5_000;

async function settleWithin(work: Promise<void>, ms: number): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([work, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
	} finally {
		clearTimeout(timer);
	}
}

export type PageWriteOutcome =
	| { type: 'ok'; page: ReservationPage }
	| { type: ReservationPageError }
	| { type: 'duplicate_slug' }
	| { type: 'limit_reached' }
	| { type: 'not_found' };

/** A guest's own change through their link. */
export type GuestChangeOutcome =
	| { type: 'ok'; start: string; end: string }
	| { type: 'not_found' }
	| { type: 'slot_taken' }
	| { type: GuestChangeBlock };

export type BookingOutcome =
	| { type: 'ok'; start: string; end: string; meetingUrl: string | null; manageUrl: string }
	| { type: 'not_found' }
	| { type: 'invalid_name' }
	| { type: 'invalid_email' }
	| { type: 'slot_taken' }
	| { type: 'too_many' };

export type ReservationsService = {
	list(userId: string): Promise<ReservationPage[]>;
	create(userId: string, body: Record<string, unknown>): Promise<PageWriteOutcome>;
	update(userId: string, id: string, body: Record<string, unknown>): Promise<PageWriteOutcome>;
	remove(userId: string, id: string): Promise<boolean>;
	/** Active pages only; `null` otherwise, the same as a page that doesn't exist. */
	publicPage(slug: string): Promise<PublicReservationPage | null>;
	slots(slug: string, fromKey: string | null): Promise<DaySlots[] | null>;
	/** `baseUrl` is this deployment's origin, for the meeting room's join link. */
	book(slug: string, body: Record<string, unknown>, baseUrl: string): Promise<BookingOutcome>;
	/**
	 * Cancels the booking behind a calendar event and tells the guest, whose
	 * calendar then drops it. `false` if there was no such booking to remove.
	 */
	cancelBooking(userId: string, eventId: string): Promise<boolean>;
	/**
	 * Moves a booking — the host accepting a guest's proposed time — and sends
	 * the guest the update. The host decides, so page hours aren't enforced;
	 * another booking already in that slot still is.
	 */
	rescheduleBooking(userId: string, eventId: string, start: Date, end: Date): Promise<'ok' | 'not_found' | 'slot_taken'>;
	/** The booking behind a guest's link, as they see it; `null` for a link that matches none. */
	managedBooking(token: string): Promise<ManagedBookingView | null>;
	/** Free slots to move it to; its own current time is left out. */
	rescheduleSlots(token: string, fromKey: string | null): Promise<DaySlots[] | null>;
	/** `baseUrl` is for the link in the updated invitation. */
	rescheduleByGuest(token: string, body: Record<string, unknown>, baseUrl: string): Promise<GuestChangeOutcome>;
	cancelByGuest(token: string): Promise<GuestChangeOutcome>;
};

export type ReservationsServiceDeps = {
	repo: ReservationsRepository;
	calendar: CalendarRepository;
	hostOf: (userId: string) => Promise<{ name: string; email: string } | null>;
	/** Meeting rooms for bookings; `null` when video meetings aren't set up on this deployment. */
	meetings: MeetingRooms | null;
	/** Best effort; a failed email never undoes a booking or a cancellation. */
	notify: (hostUserId: string, booking: BookingDetails, kind: InviteKind) => Promise<void>;
	/** Brings the host's subscribed calendars up to date. Optional; failures are ignored. */
	refreshCalendars?: (userId: string) => Promise<void>;
	/** Keeps work running after the response is sent — the Worker's `waitUntil`. */
	defer?: (work: Promise<unknown>) => void;
	now?: () => Date;
};

export type MeetingRooms = {
	/** Opens a room owned by `userId` and returns its join code; left out, settings default. */
	open(userId: string, title: string, settings?: RoomSettings): Promise<string>;
	close(userId: string, code: string): Promise<void>;
	/** The room's settings, or `null` when it's gone or not the user's. */
	settingsOf?(userId: string, code: string): Promise<RoomSettings | null>;
	/** Changes an existing room's settings; a room that's gone or not the user's is left alone. */
	configure?(userId: string, code: string, settings: RoomSettings): Promise<void>;
};

type Room = { code: string; url: string };

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique constraint/i.test(error.message);
}

function withoutOwner({ userId: _userId, ...page }: StoredPage): ReservationPage {
	return page;
}

/** The invitation's UID: fixed per booking, so the cancellation names the same event. */
export function inviteUid(eventId: string): string {
	return `${eventId}@zimail`;
}

function randomSuffix(): string {
	return crypto.randomUUID().replaceAll('-', '').slice(0, 5);
}

export function createReservationsService(deps: ReservationsServiceDeps): ReservationsService {
	const { repo } = deps;
	const now = deps.now ?? (() => new Date());

	/** Starts a background refresh of the host's calendars, or null when there is nothing to refresh with. */
	function refreshHost(userId: string): Promise<void> | null {
		if (!deps.refreshCalendars) return null;
		const work = deps.refreshCalendars(userId).catch((error) => {
			console.error('calendar refresh for booking page failed', error);
		});
		deps.defer?.(work);
		return work;
	}

	async function activePage(slug: string): Promise<StoredPage | null> {
		const page = await repo.getBySlug(slug.toLowerCase());
		return page?.active ? page : null;
	}

	/** Busy intervals near `[fromKey, fromKey + days)`, read in the page's zone. */
	/** `excluding` leaves one event out — the booking being moved doesn't block its own new time. */
	async function busyNear(page: StoredPage, fromKey: string, days: number, excluding?: string): Promise<Interval[]> {
		const from = startOfDayIn(fromKey, page.timeZone).getTime() - DAY_MS;
		const to = from + (days + 2) * DAY_MS;
		const events = await deps.calendar.listOverlapping(
			page.userId,
			new Date(from).toISOString(),
			new Date(to).toISOString(),
			2000
		);
		return events
			.filter((event) => event.busy && event.id !== excluding)
			.map((event) => eventInterval(event, page.timeZone));
	}

	/** A week of free slots from `fromKey`, clamped to today and the page's first day. */
	async function slotsFor(page: StoredPage, fromKey: string | null, excluding?: string): Promise<DaySlots[]> {
		const at = now();
		const today = dateKeyIn(at, page.timeZone);
		const requested = fromKey && /^\d{4}-\d{2}-\d{2}$/.test(fromKey) ? fromKey : today;
		const start = [requested, today, page.startDate].sort((a, b) => a.localeCompare(b))[2];
		const busy = await busyNear(page, start, SLOT_DAYS_PER_REQUEST, excluding);
		return computeSlots(page, busy, { fromKey: start, days: SLOT_DAYS_PER_REQUEST, now: at });
	}

	const manageLink = (baseUrl: string, token: string) => new URL(`/book/manage/${token}`, baseUrl).href;
	const changeDeadline = (start: Date, page: StoredPage) =>
		new Date(start.getTime() - page.rescheduleCutoffHours * 3_600_000);

	/** What every email about an existing booking says, at its next revision; `changes` overrides. */
	function detailsFor(eventId: string, booking: StoredBooking, changes: Partial<BookingDetails> = {}) {
		return {
			uid: inviteUid(eventId),
			pageTitle: booking.pageTitle,
			guestName: booking.guestName,
			guestEmail: booking.guestEmail,
			note: booking.note ?? '',
			start: new Date(booking.start),
			end: new Date(booking.end),
			timeZone: booking.timeZone,
			meetingUrl: booking.meetingUrl,
			location: booking.location,
			sequence: booking.sequence + 1,
			...changes
		};
	}

	/** A guest's link, resolved to its booking and page. */
	async function loadManaged(token: string): Promise<{ booking: ManagedBooking; page: StoredPage } | null> {
		if (!token || token.length > 100) return null;
		const booking = await repo.getBookingByToken(await hashToken(token));
		const page = booking ? await repo.get(booking.userId, booking.pageId) : null;
		return booking && page ? { booking, page } : null;
	}

	function blockFor(booking: ManagedBooking, page: StoredPage, action: 'reschedule' | 'cancel') {
		return guestChangeBlock({
			start: new Date(booking.start),
			now: now(),
			cutoffHours: page.rescheduleCutoffHours,
			rescheduleCount: booking.rescheduleCount,
			action
		});
	}

	/** Why a booking can't go ahead, or `null` if it can. The slot is re-checked here, not trusted from the page. */
	async function refuseBooking(
		page: StoredPage,
		start: Date,
		at: Date,
		email: string
	): Promise<'slot_taken' | 'too_many' | null> {
		const dateKey = dateKeyIn(start, page.timeZone);
		if (!isFreeSlot(page, await busyNear(page, dateKey, 1), start, at, dateKey)) return 'slot_taken';
		const since = new Date(at.getTime() - DAY_MS).toISOString();
		if ((await repo.countCreatedSince(page.id, since)) >= MAX_BOOKINGS_PER_DAY) return 'too_many';
		if ((await repo.countUpcomingFor(page.id, email, at.toISOString())) >= MAX_UPCOMING_PER_GUEST) return 'too_many';
		return null;
	}

	/** A booking's own room, when the page asks for one and meetings are set up. A failure books without one. */
	async function openRoom(page: StoredPage, guestName: string, baseUrl: string): Promise<Room | null> {
		if (!page.withMeeting || !deps.meetings) return null;
		try {
			const code = await deps.meetings.open(page.userId, `${page.title} · ${guestName}`.slice(0, 200));
			return { code, url: new URL(`/meet/${code}`, baseUrl).href };
		} catch {
			return null;
		}
	}

	async function closeRoom(userId: string, code: string): Promise<void> {
		await deps.meetings?.close(userId, code).catch(() => undefined);
	}

	/** Best effort: the booking or cancellation already happened either way. */
	async function tellGuest(
		userId: string,
		kind: InviteKind,
		details: Omit<BookingDetails, 'hostName' | 'hostEmail'>
	): Promise<void> {
		const host = await deps.hostOf(userId);
		if (!host) return;
		await deps.notify(userId, { ...details, hostName: host.name, hostEmail: host.email }, kind).catch(() => undefined);
	}

	async function write(
		userId: string,
		body: Record<string, unknown>,
		persist: (settings: ReservationPageSettings) => Promise<string | null>
	): Promise<PageWriteOutcome> {
		const valid = validatePageSettings(body);
		if (!valid.ok) return { type: valid.error };
		const settings = valid.value;
		if (!settings.slug) {
			const base = slugify(settings.title);
			settings.slug = base.length >= 3 ? `${base}-${randomSuffix()}` : `book-${randomSuffix()}`;
		}
		try {
			const id = await persist(settings);
			if (!id) return { type: 'not_found' };
			const page = await repo.get(userId, id);
			return page ? { type: 'ok', page: withoutOwner(page) } : { type: 'not_found' };
		} catch (error) {
			if (isUniqueConstraintError(error)) return { type: 'duplicate_slug' };
			throw error;
		}
	}

	return {
		async list(userId) {
			return (await repo.listForUser(userId)).map(withoutOwner);
		},

		async create(userId, body) {
			if ((await repo.countForUser(userId)) >= MAX_PAGES_PER_USER) return { type: 'limit_reached' };
			return write(userId, body, async (settings) => {
				const id = crypto.randomUUID();
				await repo.insert({ ...settings, id, userId });
				return id;
			});
		},

		async update(userId, id, body) {
			const existing = await repo.get(userId, id);
			if (!existing) return { type: 'not_found' };
			// An edit that leaves the slug blank keeps the current one rather than minting a new link.
			const merged = { ...body, slug: typeof body.slug === 'string' && body.slug.trim() ? body.slug : existing.slug };
			return write(userId, merged, async (settings) => ((await repo.update(userId, id, settings)) ? id : null));
		},

		remove: (userId, id) => repo.delete(userId, id),

		async publicPage(slug) {
			const page = await activePage(slug);
			if (!page) return null;
			const host = await deps.hostOf(page.userId);
			return {
				slug: page.slug,
				title: page.title,
				description: page.description,
				location: page.location,
				timeZone: page.timeZone,
				startDate: page.startDate,
				endDate: page.endDate,
				slotMinutes: page.slotMinutes,
				// Only promise a room the booking will actually get.
				withMeeting: page.withMeeting && deps.meetings !== null,
				host: host?.name ?? ''
			};
		},

		async slots(slug, fromKey) {
			const page = await activePage(slug);
			if (!page) return null;
			// Not awaited: this visitor sees what is stored, and it is fresh a moment later.
			refreshHost(page.userId);
			return slotsFor(page, fromKey);
		},

		async book(slug, body, baseUrl) {
			const page = await activePage(slug);
			if (!page) return { type: 'not_found' };
			const guest = validateGuest(body);
			if (!guest.ok) return { type: guest.error };

			const start = new Date(typeof body.start === 'string' ? body.start : '');
			if (Number.isNaN(start.getTime())) return { type: 'slot_taken' };
			const refresh = refreshHost(page.userId);
			if (refresh !== null) await settleWithin(refresh, BOOKING_REFRESH_WAIT_MS);
			const at = now();
			const refusal = await refuseBooking(page, start, at, guest.value.email);
			if (refusal) return { type: refusal };

			const end = new Date(start.getTime() + page.slotMinutes * 60_000);
			const eventId = crypto.randomUUID();
			const { name, email, note } = guest.value;
			const manageToken = createLinkToken();
			const room = await openRoom(page, name, baseUrl);
			try {
				await repo.insertBooking({
					id: crypto.randomUUID(),
					pageId: page.id,
					userId: page.userId,
					eventId,
					guestName: name,
					guestEmail: email,
					note: note || null,
					start: start.toISOString(),
					end: end.toISOString(),
					createdAt: at.toISOString(),
					eventTitle: `${name} · ${page.title}`.slice(0, 200),
					eventNotes: [`Booked by ${name} <${email}>`, room ? `Meeting: ${room.url}` : '', note]
						.filter(Boolean)
						.join('\n\n'),
					meetingCode: room?.code ?? null,
					meetingUrl: room?.url ?? null,
					eventLocation: page.location ?? room?.url ?? null,
					manageTokenHash: await hashToken(manageToken)
				});
			} catch (error) {
				// The slot went to someone else; the room opened for this attempt has no use.
				if (room) await closeRoom(page.userId, room.code);
				if (isUniqueConstraintError(error)) return { type: 'slot_taken' };
				throw error;
			}

			await tellGuest(page.userId, 'request', {
				uid: inviteUid(eventId),
				pageTitle: page.title,
				guestName: name,
				guestEmail: email,
				note,
				start,
				end,
				timeZone: page.timeZone,
				meetingUrl: room?.url ?? null,
				location: page.location,
				manage: { url: manageLink(baseUrl, manageToken), until: changeDeadline(start, page) }
			});
			return {
				type: 'ok',
				start: start.toISOString(),
				end: end.toISOString(),
				meetingUrl: room?.url ?? null,
				manageUrl: manageLink(baseUrl, manageToken)
			};
		},

		async cancelBooking(userId, eventId) {
			// Read before deleting: the guest's details go with the row.
			const booking = await repo.getBookingByEvent(userId, eventId);
			if (!(await deps.calendar.deleteReservation(userId, eventId))) return false;
			if (!booking) return true;
			if (booking.meetingCode) await closeRoom(userId, booking.meetingCode);
			await tellGuest(userId, 'cancel', detailsFor(eventId, booking, { meetingUrl: null }));
			return true;
		},

		async rescheduleBooking(userId, eventId, start, end) {
			const booking = await repo.getBookingByEvent(userId, eventId);
			if (!booking) return 'not_found';
			try {
				if (!(await repo.moveBooking(userId, eventId, start.toISOString(), end.toISOString()))) return 'not_found';
			} catch (error) {
				if (isUniqueConstraintError(error)) return 'slot_taken';
				throw error;
			}
			await tellGuest(userId, 'moved', detailsFor(eventId, booking, { start, end }));
			return 'ok';
		},

		async managedBooking(token) {
			const loaded = await loadManaged(token);
			if (!loaded) return null;
			const { booking, page } = loaded;
			const host = await deps.hostOf(booking.userId);
			return {
				pageTitle: booking.pageTitle,
				host: host?.name ?? '',
				location: booking.location,
				meetingUrl: booking.meetingUrl,
				start: booking.start,
				end: booking.end,
				timeZone: page.timeZone,
				endDate: page.endDate,
				rescheduleBlock: blockFor(booking, page, 'reschedule'),
				cancelBlock: blockFor(booking, page, 'cancel'),
				reschedulesLeft: Math.max(0, MAX_GUEST_RESCHEDULES - booking.rescheduleCount),
				changeUntil: changeDeadline(new Date(booking.start), page).toISOString()
			};
		},

		async rescheduleSlots(token, fromKey) {
			const loaded = await loadManaged(token);
			if (!loaded) return null;
			const days = await slotsFor(loaded.page, fromKey, loaded.booking.eventId);
			return days.map((day) => ({ ...day, slots: day.slots.filter((slot) => slot !== loaded.booking.start) }));
		},

		async rescheduleByGuest(token, body, baseUrl) {
			const loaded = await loadManaged(token);
			if (!loaded) return { type: 'not_found' };
			const { booking, page } = loaded;
			const block = blockFor(booking, page, 'reschedule');
			if (block) return { type: block };

			const start = new Date(typeof body.start === 'string' ? body.start : '');
			if (Number.isNaN(start.getTime()) || start.toISOString() === booking.start) return { type: 'slot_taken' };
			const dateKey = dateKeyIn(start, page.timeZone);
			const busy = await busyNear(page, dateKey, 1, booking.eventId);
			if (!isFreeSlot(page, busy, start, now(), dateKey)) return { type: 'slot_taken' };

			const end = new Date(start.getTime() + page.slotMinutes * 60_000);
			try {
				const moved = await repo.moveBooking(booking.userId, booking.eventId, start.toISOString(), end.toISOString(), true);
				if (!moved) return { type: 'not_found' };
			} catch (error) {
				if (isUniqueConstraintError(error)) return { type: 'slot_taken' };
				throw error;
			}
			await tellGuest(booking.userId, 'guest-moved', {
				...detailsFor(booking.eventId, booking, { start, end }),
				manage: { url: manageLink(baseUrl, token), until: changeDeadline(start, page) }
			});
			return { type: 'ok', start: start.toISOString(), end: end.toISOString() };
		},

		async cancelByGuest(token) {
			const loaded = await loadManaged(token);
			if (!loaded) return { type: 'not_found' };
			const { booking, page } = loaded;
			const block = blockFor(booking, page, 'cancel');
			if (block) return { type: block };
			if (!(await deps.calendar.deleteReservation(booking.userId, booking.eventId))) return { type: 'not_found' };
			if (booking.meetingCode) await closeRoom(booking.userId, booking.meetingCode);
			await tellGuest(booking.userId, 'guest-cancel', detailsFor(booking.eventId, booking, { meetingUrl: null }));
			return { type: 'ok', start: booking.start, end: booking.end };
		}
	};
}
