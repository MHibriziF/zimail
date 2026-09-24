import type { D1Database } from '@cloudflare/workers-types';
import {
	CALENDAR_EVENT_SOURCES,
	type CalendarEvent,
	type CalendarEventSource,
	type ValidEventInput
} from '../../calendar/events';
import { LABEL_COLORS } from '../../mail/labels';

type EventRow = {
	id: string;
	title: string;
	starts_at: string;
	ends_at: string;
	all_day: number;
	location: string | null;
	notes: string | null;
	source: string;
	busy: number;
	feed_name: string | null;
	feed_color: string | null;
};

const COLUMNS = `e.id, e.title, e.starts_at, e.ends_at, e.all_day, e.location, e.notes, e.source, e.busy,
	f.name AS feed_name, f.color AS feed_color`;
/** Feed events carry their calendar's name and color; the join finds nothing for other sources. */
const FROM = `calendar_events e LEFT JOIN calendar_feeds f ON e.source = 'feed' AND f.id = e.source_id`;

function toEvent(row: EventRow): CalendarEvent {
	return {
		id: row.id,
		title: row.title,
		start: row.starts_at,
		end: row.ends_at,
		allDay: row.all_day === 1,
		location: row.location,
		notes: row.notes,
		source: CALENDAR_EVENT_SOURCES.find((source) => source === row.source) ?? 'manual',
		busy: row.busy === 1,
		calendar:
			row.feed_name === null
				? null
				: { name: row.feed_name, color: LABEL_COLORS.find((color) => color === row.feed_color) ?? 'blue' }
	};
}

export type NewCalendarEvent = ValidEventInput & {
	id: string;
	userId: string;
	source: CalendarEventSource;
	sourceId?: string | null;
	externalUid?: string | null;
	busy?: boolean;
};

/**
 * Raw D1 access for calendar events, every query scoped by `user_id`. No
 * validation here — see `./service.ts`. `update`/`delete` touch only 'manual'
 * rows; feed and reservation rows are rewritten by their own features.
 */
export type CalendarRepository = {
	/** Events overlapping `[from, to)`, by the stored instants. */
	listOverlapping(userId: string, from: string, to: string, limit: number): Promise<CalendarEvent[]>;
	get(userId: string, id: string): Promise<CalendarEvent | null>;
	insert(event: NewCalendarEvent): Promise<void>;
	updateManual(userId: string, id: string, input: ValidEventInput): Promise<boolean>;
	deleteManual(userId: string, id: string): Promise<boolean>;
	/** Cancels a booking: its reservation row and the event that blocks the slot. */
	deleteReservation(userId: string, id: string): Promise<boolean>;
	/** Takes a received invitation off the calendar: every occurrence of the series `id` belongs to. */
	deleteInvite(userId: string, id: string): Promise<boolean>;
};

export function createD1CalendarRepository(db: D1Database): CalendarRepository {
	return {
		async listOverlapping(userId, from, to, limit) {
			const { results } = await db
				.prepare(
					`SELECT ${COLUMNS} FROM ${FROM}
					 WHERE e.user_id = ? AND e.starts_at < ? AND e.ends_at > ?
					 ORDER BY e.starts_at LIMIT ?`
				)
				.bind(userId, to, from, limit)
				.all<EventRow>();
			return results.map(toEvent);
		},

		async get(userId, id) {
			const row = await db
				.prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE e.id = ? AND e.user_id = ?`)
				.bind(id, userId)
				.first<EventRow>();
			return row ? toEvent(row) : null;
		},

		async insert(event) {
			await db
				.prepare(
					`INSERT INTO calendar_events
					 (id, user_id, source, source_id, external_uid, title, starts_at, ends_at, all_day, location, notes, busy)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					event.id,
					event.userId,
					event.source,
					event.sourceId ?? null,
					event.externalUid ?? null,
					event.title,
					event.start,
					event.end,
					event.allDay ? 1 : 0,
					event.location,
					event.notes,
					event.busy === false ? 0 : 1
				)
				.run();
		},

		async updateManual(userId, id, input) {
			const result = await db
				.prepare(
					`UPDATE calendar_events
					 SET title = ?, starts_at = ?, ends_at = ?, all_day = ?, location = ?, notes = ?,
					     updated_at = CURRENT_TIMESTAMP
					 WHERE id = ? AND user_id = ? AND source = 'manual'`
				)
				.bind(
					input.title,
					input.start,
					input.end,
					input.allDay ? 1 : 0,
					input.location,
					input.notes,
					id,
					userId
				)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async deleteManual(userId, id) {
			const result = await db
				.prepare(`DELETE FROM calendar_events WHERE id = ? AND user_id = ? AND source = 'manual'`)
				.bind(id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async deleteReservation(userId, id) {
			const [, result] = await db.batch([
				db.prepare('DELETE FROM reservations WHERE event_id = ? AND user_id = ?').bind(id, userId),
				db
					.prepare(`DELETE FROM calendar_events WHERE id = ? AND user_id = ? AND source = 'reservation'`)
					.bind(id, userId)
			]);
			return (result.meta.changes ?? 0) > 0;
		},

		async deleteInvite(userId, id) {
			const result = await db
				.prepare(
					`DELETE FROM calendar_events
					 WHERE user_id = ? AND source = 'invite' AND source_id = (
						SELECT source_id FROM calendar_events WHERE id = ? AND user_id = ? AND source = 'invite'
					 )`
				)
				.bind(userId, id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		}
	};
}
