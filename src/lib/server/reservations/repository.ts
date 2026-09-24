import type { D1Database } from '@cloudflare/workers-types';
import type { ReservationPage, ReservationPageSettings } from '../../calendar/reservations';

type PageRow = {
	id: string;
	user_id: string;
	slug: string;
	title: string;
	description: string | null;
	time_zone: string;
	start_date: string;
	end_date: string;
	weekdays: string;
	day_start: number;
	day_end: number;
	slot_minutes: number;
	buffer_minutes: number;
	notice_minutes: number;
	active: number;
	with_meeting: number;
};

export type StoredPage = ReservationPage & { userId: string };

function toPage(row: PageRow): StoredPage {
	return {
		id: row.id,
		userId: row.user_id,
		slug: row.slug,
		title: row.title,
		description: row.description,
		timeZone: row.time_zone,
		startDate: row.start_date,
		endDate: row.end_date,
		weekdays: row.weekdays
			.split(',')
			.map(Number)
			.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
		dayStart: row.day_start,
		dayEnd: row.day_end,
		slotMinutes: row.slot_minutes,
		bufferMinutes: row.buffer_minutes,
		noticeMinutes: row.notice_minutes,
		active: row.active === 1,
		withMeeting: row.with_meeting === 1
	};
}

const COLUMNS = `id, user_id, slug, title, description, time_zone, start_date, end_date, weekdays,
	day_start, day_end, slot_minutes, buffer_minutes, notice_minutes, active, with_meeting`;

export type NewBooking = {
	id: string;
	pageId: string;
	userId: string;
	eventId: string;
	guestName: string;
	guestEmail: string;
	note: string | null;
	start: string;
	end: string;
	createdAt: string;
	eventTitle: string;
	eventNotes: string;
	/** The booking's own meeting room, when the page gives one. */
	meetingCode: string | null;
	/** The join link, shown as the calendar event's location. */
	eventLocation: string | null;
};

/**
 * Raw D1 access for reservation pages and bookings. Owner-facing queries are
 * scoped by `user_id`; `getBySlug` and the booking helpers serve the public
 * page and are scoped by the page instead.
 */
export type ReservationsRepository = {
	listForUser(userId: string): Promise<StoredPage[]>;
	countForUser(userId: string): Promise<number>;
	get(userId: string, id: string): Promise<StoredPage | null>;
	getBySlug(slug: string): Promise<StoredPage | null>;
	insert(page: ReservationPageSettings & { id: string; userId: string }): Promise<void>;
	update(userId: string, id: string, page: ReservationPageSettings): Promise<boolean>;
	delete(userId: string, id: string): Promise<boolean>;
	/** Bookings made on the page since `since` — a flood check. */
	countCreatedSince(pageId: string, since: string): Promise<number>;
	/** Upcoming bookings by one guest address. */
	countUpcomingFor(pageId: string, email: string, now: string): Promise<number>;
	/** The reservation and its calendar event, in one batch. Throws on a taken slot. */
	insertBooking(booking: NewBooking): Promise<void>;
	/** The booking behind a calendar event, with what a cancellation email needs. */
	getBookingByEvent(userId: string, eventId: string): Promise<StoredBooking | null>;
	/** Moves a booking and bumps its invitation revision; `false` if there was no such booking. */
	moveBooking(userId: string, eventId: string, start: string, end: string): Promise<boolean>;
};

export type StoredBooking = {
	guestName: string;
	guestEmail: string;
	note: string | null;
	start: string;
	end: string;
	pageTitle: string;
	timeZone: string;
	meetingCode: string | null;
	/** The join link the guest was given, kept as the event's location. */
	meetingUrl: string | null;
	/** The invitation revision the guest last received. */
	sequence: number;
};

function settingsValues(page: ReservationPageSettings): unknown[] {
	return [
		page.slug,
		page.title,
		page.description,
		page.timeZone,
		page.startDate,
		page.endDate,
		page.weekdays.join(','),
		page.dayStart,
		page.dayEnd,
		page.slotMinutes,
		page.bufferMinutes,
		page.noticeMinutes,
		page.active ? 1 : 0,
		page.withMeeting ? 1 : 0
	];
}

export function createD1ReservationsRepository(db: D1Database): ReservationsRepository {
	return {
		async listForUser(userId) {
			const { results } = await db
				.prepare(`SELECT ${COLUMNS} FROM reservation_pages WHERE user_id = ? ORDER BY created_at`)
				.bind(userId)
				.all<PageRow>();
			return results.map(toPage);
		},

		async countForUser(userId) {
			const row = await db
				.prepare('SELECT COUNT(*) AS count FROM reservation_pages WHERE user_id = ?')
				.bind(userId)
				.first<{ count: number }>();
			return row?.count ?? 0;
		},

		async get(userId, id) {
			const row = await db
				.prepare(`SELECT ${COLUMNS} FROM reservation_pages WHERE id = ? AND user_id = ?`)
				.bind(id, userId)
				.first<PageRow>();
			return row ? toPage(row) : null;
		},

		async getBySlug(slug) {
			const row = await db
				.prepare(`SELECT ${COLUMNS} FROM reservation_pages WHERE slug = ? COLLATE NOCASE`)
				.bind(slug)
				.first<PageRow>();
			return row ? toPage(row) : null;
		},

		async insert(page) {
			await db
				.prepare(
					`INSERT INTO reservation_pages
					 (id, user_id, slug, title, description, time_zone, start_date, end_date, weekdays,
					  day_start, day_end, slot_minutes, buffer_minutes, notice_minutes, active, with_meeting)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(page.id, page.userId, ...settingsValues(page))
				.run();
		},

		async update(userId, id, page) {
			const result = await db
				.prepare(
					`UPDATE reservation_pages
					 SET slug = ?, title = ?, description = ?, time_zone = ?, start_date = ?, end_date = ?, weekdays = ?,
					     day_start = ?, day_end = ?, slot_minutes = ?, buffer_minutes = ?, notice_minutes = ?, active = ?,
					     with_meeting = ?
					 WHERE id = ? AND user_id = ?`
				)
				.bind(...settingsValues(page), id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async delete(userId, id) {
			// Bookings already made stay on the calendar as events; only their reservation rows cascade.
			const result = await db
				.prepare('DELETE FROM reservation_pages WHERE id = ? AND user_id = ?')
				.bind(id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async countCreatedSince(pageId, since) {
			const row = await db
				.prepare('SELECT COUNT(*) AS count FROM reservations WHERE page_id = ? AND created_at > ?')
				.bind(pageId, since)
				.first<{ count: number }>();
			return row?.count ?? 0;
		},

		async countUpcomingFor(pageId, email, now) {
			const row = await db
				.prepare(
					'SELECT COUNT(*) AS count FROM reservations WHERE page_id = ? AND guest_email = ? COLLATE NOCASE AND starts_at > ?'
				)
				.bind(pageId, email, now)
				.first<{ count: number }>();
			return row?.count ?? 0;
		},

		async getBookingByEvent(userId, eventId) {
			const row = await db
				.prepare(
					`SELECT r.guest_name, r.guest_email, r.note, r.starts_at, r.ends_at, r.meeting_code, p.title, p.time_zone,
					        e.location, COALESCE(e.sequence, 0) AS sequence
					 FROM reservations r JOIN reservation_pages p ON p.id = r.page_id
					 LEFT JOIN calendar_events e ON e.id = r.event_id
					 WHERE r.event_id = ? AND r.user_id = ?`
				)
				.bind(eventId, userId)
				.first<{
					guest_name: string;
					guest_email: string;
					note: string | null;
					starts_at: string;
					ends_at: string;
					meeting_code: string | null;
					title: string;
					time_zone: string;
					location: string | null;
					sequence: number;
				}>();
			if (!row) return null;
			return {
				guestName: row.guest_name,
				guestEmail: row.guest_email,
				note: row.note,
				start: row.starts_at,
				end: row.ends_at,
				pageTitle: row.title,
				timeZone: row.time_zone,
				meetingCode: row.meeting_code,
				meetingUrl: row.meeting_code ? row.location : null,
				sequence: row.sequence
			};
		},

		async insertBooking(booking) {
			await db.batch([
				db
					.prepare(
						`INSERT INTO reservations
						 (id, page_id, user_id, event_id, guest_name, guest_email, note, starts_at, ends_at, created_at, meeting_code)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(
						booking.id,
						booking.pageId,
						booking.userId,
						booking.eventId,
						booking.guestName,
						booking.guestEmail,
						booking.note,
						booking.start,
						booking.end,
						booking.createdAt,
						booking.meetingCode
					),
				db
					.prepare(
						`INSERT INTO calendar_events (id, user_id, source, source_id, title, starts_at, ends_at, all_day, location, notes, busy)
						 VALUES (?, ?, 'reservation', ?, ?, ?, ?, 0, ?, ?, 1)`
					)
					.bind(
						booking.eventId,
						booking.userId,
						booking.pageId,
						booking.eventTitle,
						booking.start,
						booking.end,
						booking.eventLocation,
						booking.eventNotes
					),
				db
					.prepare('INSERT INTO event_guests (event_id, user_id, email, name) VALUES (?, ?, lower(?), ?)')
					.bind(booking.eventId, booking.userId, booking.guestEmail, booking.guestName)
			]);
		},

		async moveBooking(userId, eventId, start, end) {
			const [, moved] = await db.batch([
				db
					.prepare('UPDATE reservations SET starts_at = ?, ends_at = ? WHERE event_id = ? AND user_id = ?')
					.bind(start, end, eventId, userId),
				db
					.prepare(
						`UPDATE calendar_events
						 SET starts_at = ?, ends_at = ?, sequence = sequence + 1, updated_at = CURRENT_TIMESTAMP
						 WHERE id = ? AND user_id = ? AND source = 'reservation'`
					)
					.bind(start, end, eventId, userId)
			]);
			return (moved.meta.changes ?? 0) > 0;
		}
	};
}
