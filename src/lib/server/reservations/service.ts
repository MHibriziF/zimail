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
import type { BookingDetails } from './email';
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
	| { type: 'ok'; start: string; end: string }
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
	book(slug: string, body: Record<string, unknown>): Promise<BookingOutcome>;
};

export type ReservationsServiceDeps = {
	repo: ReservationsRepository;
	calendar: CalendarRepository;
	hostOf: (userId: string) => Promise<{ name: string; email: string } | null>;
	/** Best effort; a failed email never undoes a booking. */
	notify: (hostUserId: string, booking: BookingDetails) => Promise<void>;
	now?: () => Date;
};

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique constraint/i.test(error.message);
}

function withoutOwner({ userId: _userId, ...page }: StoredPage): ReservationPage {
	return page;
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

		async book(slug, body) {
			const page = await activePage(slug);
			if (!page) return { type: 'not_found' };
			const guest = validateGuest(body);
			if (!guest.ok) return { type: guest.error };

			const start = new Date(typeof body.start === 'string' ? body.start : '');
			if (Number.isNaN(start.getTime())) return { type: 'slot_taken' };
			const at = now();
			const dateKey = dateKeyIn(start, page.timeZone);
			if (!isFreeSlot(page, await busyNear(page, dateKey, 1), start, at, dateKey)) return { type: 'slot_taken' };

			const since = new Date(at.getTime() - DAY_MS).toISOString();
			if (
				(await repo.countCreatedSince(page.id, since)) >= MAX_BOOKINGS_PER_DAY ||
				(await repo.countUpcomingFor(page.id, guest.value.email, at.toISOString())) >= MAX_UPCOMING_PER_GUEST
			) {
				return { type: 'too_many' };
			}

			const end = new Date(start.getTime() + page.slotMinutes * 60_000);
			const eventId = crypto.randomUUID();
			const { name, email, note } = guest.value;
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
					eventNotes: [`Booked by ${name} <${email}>`, note].filter(Boolean).join('\n\n')
				});
			} catch (error) {
				if (isUniqueConstraintError(error)) return { type: 'slot_taken' };
				throw error;
			}

			const host = await deps.hostOf(page.userId);
			if (host) {
				await deps
					.notify(page.userId, {
						uid: `${eventId}@zimail`,
						pageTitle: page.title,
						hostName: host.name,
						hostEmail: host.email,
						guestName: name,
						guestEmail: email,
						note,
						start,
						end,
						timeZone: page.timeZone
					})
					.catch(() => undefined);
			}
			return { type: 'ok', start: start.toISOString(), end: end.toISOString() };
		}
	};
}
