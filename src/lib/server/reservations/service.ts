import { eventInterval } from '../../calendar/events';
import { dateKeyIn, startOfDayIn } from '../../calendar/grid';
import {
	MAX_PAGES_PER_USER,
	SLOT_DAYS_PER_REQUEST,
	slugify,
	validateGuest,
	validatePageSettings,
	type PublicReservationPage,
	type ReservationPage,
	type ReservationPageError,
	type ReservationPageSettings
} from '../../calendar/reservations';
import { computeSlots, isFreeSlot, type DaySlots, type Interval } from '../../calendar/slots';
import type { CalendarRepository } from '../calendar/repository';
import type { BookingDetails, InviteKind } from './email';
import type { ReservationsRepository, StoredPage } from './repository';

const DAY_MS = 86_400_000;
/** A page takes at most this many bookings a day, and one guest address this many upcoming ones. */
export const MAX_BOOKINGS_PER_DAY = 30;
export const MAX_UPCOMING_PER_GUEST = 3;

export type PageWriteOutcome =
	| { type: 'ok'; page: ReservationPage }
	| { type: ReservationPageError }
	| { type: 'duplicate_slug' }
	| { type: 'limit_reached' }
	| { type: 'not_found' };

export type BookingOutcome =
	| { type: 'ok'; start: string; end: string; meetingUrl: string | null }
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
};

export type ReservationsServiceDeps = {
	repo: ReservationsRepository;
	calendar: CalendarRepository;
	hostOf: (userId: string) => Promise<{ name: string; email: string } | null>;
	/** Meeting rooms for bookings; `null` when video meetings aren't set up on this deployment. */
	meetings: MeetingRooms | null;
	/** Best effort; a failed email never undoes a booking or a cancellation. */
	notify: (hostUserId: string, booking: BookingDetails, kind: InviteKind) => Promise<void>;
	now?: () => Date;
};

export type MeetingRooms = {
	/** Opens a room owned by `userId` and returns its join code. */
	open(userId: string, title: string): Promise<string>;
	close(userId: string, code: string): Promise<void>;
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

	async function activePage(slug: string): Promise<StoredPage | null> {
		const page = await repo.getBySlug(slug.toLowerCase());
		return page?.active ? page : null;
	}

	/** Busy intervals near `[fromKey, fromKey + days)`, read in the page's zone. */
	async function busyNear(page: StoredPage, fromKey: string, days: number): Promise<Interval[]> {
		const from = startOfDayIn(fromKey, page.timeZone).getTime() - DAY_MS;
		const to = from + (days + 2) * DAY_MS;
		const events = await deps.calendar.listOverlapping(
			page.userId,
			new Date(from).toISOString(),
			new Date(to).toISOString(),
			2000
		);
		return events.filter((event) => event.busy).map((event) => eventInterval(event, page.timeZone));
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
			const at = now();
			const today = dateKeyIn(at, page.timeZone);
			const requested = fromKey && /^\d{4}-\d{2}-\d{2}$/.test(fromKey) ? fromKey : today;
			const start = [requested, today, page.startDate].sort((a, b) => a.localeCompare(b))[2];
			const busy = await busyNear(page, start, SLOT_DAYS_PER_REQUEST);
			return computeSlots(page, busy, { fromKey: start, days: SLOT_DAYS_PER_REQUEST, now: at });
		},

		async book(slug, body, baseUrl) {
			const page = await activePage(slug);
			if (!page) return { type: 'not_found' };
			const guest = validateGuest(body);
			if (!guest.ok) return { type: guest.error };

			const start = new Date(typeof body.start === 'string' ? body.start : '');
			if (Number.isNaN(start.getTime())) return { type: 'slot_taken' };
			const at = now();
			const refusal = await refuseBooking(page, start, at, guest.value.email);
			if (refusal) return { type: refusal };

			const end = new Date(start.getTime() + page.slotMinutes * 60_000);
			const eventId = crypto.randomUUID();
			const { name, email, note } = guest.value;
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
					eventLocation: room?.url ?? null
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
				meetingUrl: room?.url ?? null
			});
			return { type: 'ok', start: start.toISOString(), end: end.toISOString(), meetingUrl: room?.url ?? null };
		},

		async cancelBooking(userId, eventId) {
			// Read before deleting: the guest's details go with the row.
			const booking = await repo.getBookingByEvent(userId, eventId);
			if (!(await deps.calendar.deleteReservation(userId, eventId))) return false;
			if (!booking) return true;
			if (booking.meetingCode) await closeRoom(userId, booking.meetingCode);
			await tellGuest(userId, 'cancel', {
				uid: inviteUid(eventId),
				pageTitle: booking.pageTitle,
				guestName: booking.guestName,
				guestEmail: booking.guestEmail,
				note: booking.note ?? '',
				start: new Date(booking.start),
				end: new Date(booking.end),
				timeZone: booking.timeZone,
				meetingUrl: null
			});
			return true;
		}
	};
}
