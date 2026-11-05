import { addDays, eventInterval } from '../../calendar/events';
import { dateKeyIn, startOfDayIn } from '../../calendar/grid';
import {
	guestChangeBlock,
	MAX_BOOKINGS_PER_DAY,
	MAX_GUEST_RESCHEDULES,
	MAX_PAGES_PER_USER,
	MAX_SLOT_DAYS,
	MAX_UPCOMING_PER_GUEST,
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
import { bookingIcs, type BookingDetails, type InviteKind } from './email';
import {
	nextReminderAt,
	REMINDER_QUIET_MS,
	reminderKind,
	type ReminderKind,
	type ReminderSetting
} from '../../calendar/reminders';
import type { RoomSettings } from '../../meet/room-settings';
import type { DueReminder, ManagedBooking, ReservationsRepository, StoredBooking, StoredPage } from './repository';
import { createLinkToken, hashToken } from '../util/crypto';

const DAY_MS = 86_400_000;
export { MAX_BOOKINGS_PER_DAY, MAX_UPCOMING_PER_GUEST };
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
	| { type: 'day_full' }
	| { type: GuestChangeBlock };

export type BookingOutcome =
	| { type: 'ok'; start: string; end: string; meetingUrl: string | null; manageUrl: string }
	| { type: 'not_found' }
	| { type: 'invalid_name' }
	| { type: 'invalid_email' }
	| { type: 'slot_taken' }
	/** The day already holds the page's `maxPerDay` bookings. */
	| { type: 'day_full' }
	/** This guest address already holds `MAX_UPCOMING_PER_GUEST` upcoming bookings on the page. */
	| { type: 'guest_limit' }
	/** The page took `MAX_BOOKINGS_PER_DAY` bookings in the last 24 hours. */
	| { type: 'page_busy' };

export type ReservationsService = {
	list(userId: string): Promise<ReservationPage[]>;
	create(userId: string, body: Record<string, unknown>): Promise<PageWriteOutcome>;
	update(userId: string, id: string, body: Record<string, unknown>): Promise<PageWriteOutcome>;
	remove(userId: string, id: string): Promise<boolean>;
	/** Active pages only; `null` otherwise, the same as a page that doesn't exist. */
	publicPage(slug: string): Promise<PublicReservationPage | null>;
	/** `days` defaults to a week and is capped at MAX_SLOT_DAYS. */
	slots(slug: string, fromKey: string | null, days?: number): Promise<DaySlots[] | null>;
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
	rescheduleSlots(token: string, fromKey: string | null, days?: number): Promise<DaySlots[] | null>;
	/** `baseUrl` is for the link in the updated invitation. */
	rescheduleByGuest(token: string, body: Record<string, unknown>, baseUrl: string): Promise<GuestChangeOutcome>;
	cancelByGuest(token: string): Promise<GuestChangeOutcome>;
	/** Sends the reminders that are due, for the cron trigger. Each is claimed before it's sent, so none goes twice. */
	sendDueReminders(): Promise<{ sent: number; skipped: number }>;
	/** The booking behind a guest's link as a calendar file they can import; `null` for a link that matches none. */
	bookingIcsFor(token: string): Promise<{ ics: string; title: string } | null>;
};

export type ReservationsServiceDeps = {
	repo: ReservationsRepository;
	calendar: CalendarRepository;
	hostOf: (userId: string) => Promise<{ name: string; email: string } | null>;
	/** Meeting rooms for bookings; `null` when video meetings aren't set up on this deployment. */
	meetings: MeetingRooms | null;
	/** Best effort; a failed email never undoes a booking or a cancellation. */
	notify: (hostUserId: string, booking: BookingDetails, kind: InviteKind) => Promise<void>;
	/** Sends one reminder. Optional: without it, due reminders are claimed and dropped. */
	remind?: (hostUserId: string, booking: BookingDetails, kind: ReminderKind) => Promise<void>;
	/** Brings the host's subscribed calendars up to date. Optional; failures are ignored. */
	refreshCalendars?: (userId: string) => Promise<void>;
	/** Keeps work running after the response is sent — the Worker's `waitUntil`. */
	defer?: (work: Promise<unknown>) => void;
	now?: () => Date;
};

export type MeetingRooms = {
	/** Opens a room owned by `userId` and returns its join code; left out, settings default. */
	open(userId: string, title: string, settings?: RoomSettings, schedule?: RoomSchedule): Promise<string>;
	/** Moves the time a room says it is booked for; a room that's gone or not the user's is left alone. */
	reschedule?(userId: string, code: string, schedule: RoomSchedule): Promise<void>;
	close(userId: string, code: string): Promise<void>;
	/** The room's settings, or `null` when it's gone or not the user's. */
	settingsOf?(userId: string, code: string): Promise<RoomSettings | null>;
	/** Changes an existing room's settings; a room that's gone or not the user's is left alone. */
	configure?(userId: string, code: string, settings: RoomSettings): Promise<void>;
};

type Room = { code: string; url: string };

/** When a room is booked for, as ISO instants. */
export type RoomSchedule = { start: string; end: string };

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

/** What every email about an existing booking says, at its next revision; `changes` overrides. */
/** A booking's first reminder; none due right after the confirmation it was just sent. */
function firstReminder(start: Date, setting: ReminderSetting, at: Date): string | null {
	return nextReminderAt(start, setting, new Date(at.getTime() + REMINDER_QUIET_MS))?.toISOString() ?? null;
}

/** How many due reminders one sweep handles; the rest wait a minute for the next. */
export const REMINDER_BATCH = 20;
/** After a reminder goes out, the next one has to be at least this far off, or it's skipped. */
const REMINDER_GAP_MS = 30 * 60_000;

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
		collaborators: booking.collaborators,
		...changes
	};
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
	async function slotsFor(page: StoredPage, fromKey: string | null, days: number, excluding?: string): Promise<DaySlots[]> {
		const at = now();
		const today = dateKeyIn(at, page.timeZone);
		const requested = fromKey && /^\d{4}-\d{2}-\d{2}$/.test(fromKey) ? fromKey : today;
		const start = [requested, today, page.startDate].sort((a, b) => a.localeCompare(b))[2];
		const count = Math.min(Math.max(1, days), MAX_SLOT_DAYS);
		const [busy, full] = await Promise.all([busyNear(page, start, count, excluding), fullDays(page, start, count, excluding)]);
		const found = computeSlots(page, busy, { fromKey: start, days: count, now: at });
		return full.size === 0 ? found : found.map((day) => (full.has(day.date) ? { ...day, slots: [] } : day));
	}

	/**
	 * Days in `[fromKey, fromKey + days)` that already hold the page's daily
	 * cap of bookings, in its zone. Nothing to read when the page has no cap.
	 * `excluding` is a booking being moved, which doesn't count against its own day.
	 */
	async function fullDays(page: StoredPage, fromKey: string, days: number, excluding?: string): Promise<Set<string>> {
		const cap = page.maxPerDay;
		if (!cap) return new Set();
		const from = startOfDayIn(fromKey, page.timeZone).toISOString();
		const to = startOfDayIn(addDays(fromKey, days), page.timeZone).toISOString();
		const perDay = new Map<string, number>();
		for (const start of await repo.listStartsBetween(page.id, from, to, excluding)) {
			const key = dateKeyIn(new Date(start), page.timeZone);
			perDay.set(key, (perDay.get(key) ?? 0) + 1);
		}
		return new Set([...perDay].filter(([, count]) => count >= cap).map(([key]) => key));
	}

	const manageLink = (baseUrl: string, token: string) => new URL(`/book/manage/${token}`, baseUrl).href;
	const changeDeadline = (start: Date, page: StoredPage) =>
		new Date(start.getTime() - page.rescheduleCutoffHours * 3_600_000);

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
	): Promise<'slot_taken' | 'day_full' | 'guest_limit' | 'page_busy' | null> {
		const dateKey = dateKeyIn(start, page.timeZone);
		if (!isFreeSlot(page, await busyNear(page, dateKey, 1), start, at, dateKey)) return 'slot_taken';
		if ((await fullDays(page, dateKey, 1)).has(dateKey)) return 'day_full';
		// The guest's own limit first: it's the one they can do something about.
		if ((await repo.countUpcomingFor(page.id, email, at.toISOString())) >= MAX_UPCOMING_PER_GUEST) return 'guest_limit';
		const since = new Date(at.getTime() - DAY_MS).toISOString();
		if ((await repo.countCreatedSince(page.id, since)) >= MAX_BOOKINGS_PER_DAY) return 'page_busy';
		return null;
	}

	/** A booking's own room, when the page asks for one and meetings are set up. A failure books without one. */
	async function openRoom(page: StoredPage, guestName: string, baseUrl: string, schedule: RoomSchedule): Promise<Room | null> {
		if (!page.withMeeting || !deps.meetings) return null;
		try {
			const title = `${page.title} · ${guestName}`.slice(0, 200);
			const code = await deps.meetings.open(page.userId, title, page.roomSettings ?? undefined, schedule);
			return { code, url: new URL(`/meet/${code}`, baseUrl).href };
		} catch {
			return null;
		}
	}

	async function closeRoom(userId: string, code: string): Promise<void> {
		await deps.meetings?.close(userId, code).catch(() => undefined);
	}

	/** Best effort, like the email: a room still showing the old time doesn't undo the move. */
	async function moveRoom(userId: string, code: string | null, start: Date, end: Date): Promise<void> {
		if (!code) return;
		await deps.meetings?.reschedule?.(userId, code, { start: start.toISOString(), end: end.toISOString() }).catch(() => undefined);
	}

	/** Sends one claimed reminder. A failure costs this one reminder rather than risking a second copy. */
	async function deliverReminder(due: DueReminder, kind: ReminderKind): Promise<boolean> {
		if (!deps.remind) return false;
		try {
			const booking = await repo.getBookingByEvent(due.userId, due.eventId);
			const host = booking ? await deps.hostOf(due.userId) : null;
			if (!booking || !host) return false;
			// Not a new revision: the reminder doesn't change the event the guest already has.
			const details = { ...detailsFor(due.eventId, booking), sequence: booking.sequence, hostName: host.name, hostEmail: host.email };
			await deps.remind(due.userId, details, kind);
			return true;
		} catch (error) {
			console.error('booking reminder failed', error);
			return false;
		}
	}

	/** Best effort: the booking or cancellation already happened either way. */
	async function tellGuest(
		userId: string,
		kind: InviteKind,
		details: Omit<BookingDetails, 'hostName' | 'hostEmail'>
	): Promise<void> {
		const host = await deps.hostOf(userId);
		if (!host) return;
		// The host already gets a Bcc copy, and the guest is on To in their own right.
		const others = new Set([host.email.toLowerCase(), details.guestEmail.toLowerCase()]);
		const collaborators = (details.collaborators ?? []).filter((email) => !others.has(email.toLowerCase()));
		await deps
			.notify(userId, { ...details, collaborators, hostName: host.name, hostEmail: host.email }, kind)
			.catch(() => undefined);
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

		async slots(slug, fromKey, days = SLOT_DAYS_PER_REQUEST) {
			const page = await activePage(slug);
			if (!page) return null;
			// Not awaited: this visitor sees what is stored, and it is fresh a moment later.
			refreshHost(page.userId);
			return slotsFor(page, fromKey, days);
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
			const room = await openRoom(page, name, baseUrl, { start: start.toISOString(), end: end.toISOString() });
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
					manageTokenHash: await hashToken(manageToken),
					collaborators: page.collaborators,
					nextReminderAt: firstReminder(start, page.reminders, at)
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
				manage: { url: manageLink(baseUrl, manageToken), until: changeDeadline(start, page) },
				collaborators: page.collaborators
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
				const reminder = firstReminder(start, booking.reminders, now());
				if (!(await repo.moveBooking(userId, eventId, start.toISOString(), end.toISOString(), false, reminder))) return 'not_found';
			} catch (error) {
				if (isUniqueConstraintError(error)) return 'slot_taken';
				throw error;
			}
			await moveRoom(userId, booking.meetingCode, start, end);
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

		async rescheduleSlots(token, fromKey, days = SLOT_DAYS_PER_REQUEST) {
			const loaded = await loadManaged(token);
			if (!loaded) return null;
			const found = await slotsFor(loaded.page, fromKey, days, loaded.booking.eventId);
			return found.map((day) => ({ ...day, slots: day.slots.filter((slot) => slot !== loaded.booking.start) }));
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
			if ((await fullDays(page, dateKey, 1, booking.eventId)).has(dateKey)) return { type: 'day_full' };

			const end = new Date(start.getTime() + page.slotMinutes * 60_000);
			try {
				const reminder = firstReminder(start, page.reminders, now());
				const moved = await repo.moveBooking(booking.userId, booking.eventId, start.toISOString(), end.toISOString(), true, reminder);
				if (!moved) return { type: 'not_found' };
			} catch (error) {
				if (isUniqueConstraintError(error)) return { type: 'slot_taken' };
				throw error;
			}
			await moveRoom(booking.userId, booking.meetingCode, start, end);
			await tellGuest(booking.userId, 'guest-moved', {
				...detailsFor(booking.eventId, booking, { start, end }),
				manage: { url: manageLink(baseUrl, token), until: changeDeadline(start, page) }
			});
			return { type: 'ok', start: start.toISOString(), end: end.toISOString() };
		},

		async sendDueReminders() {
			const at = now();
			let sent = 0;
			let skipped = 0;
			for (const due of await repo.dueReminders(at.toISOString(), REMINDER_BATCH)) {
				const start = new Date(due.start);
				const kind = reminderKind(start, new Date(due.dueAt));
				// The page may have turned this reminder off since the booking was made; then only move on.
				const wanted = due.reminders === 'both' || due.reminders === kind;
				const later = nextReminderAt(start, due.reminders, new Date(Math.max(at.getTime(), Date.parse(due.dueAt)) + REMINDER_GAP_MS));
				const claimed = await repo.claimReminder(due.id, due.dueAt, later?.toISOString() ?? null);
				const delivered = claimed && wanted && start > at && (await deliverReminder(due, kind));
				if (delivered) sent += 1;
				else skipped += 1;
			}
			return { sent, skipped };
		},

		async bookingIcsFor(token) {
			const loaded = await loadManaged(token);
			if (!loaded) return null;
			const { booking } = loaded;
			const host = await deps.hostOf(booking.userId);
			if (!host) return null;
			const details = { ...detailsFor(booking.eventId, booking), sequence: booking.sequence, hostName: host.name, hostEmail: host.email };
			return { ics: bookingIcs(details, 'publish', now()), title: booking.pageTitle };
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
