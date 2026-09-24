import {
	eventInterval,
	isReadOnlyEvent,
	validateEventInput,
	type CalendarEvent,
	type CalendarEventInput
} from '../../calendar/events';
import type { CalendarRepository } from './repository';

export type CalendarWriteOutcome =
	| { type: 'ok'; event: CalendarEvent }
	| { type: 'invalid_title' }
	| { type: 'invalid_time' }
	| { type: 'read_only' }
	| { type: 'not_found' };

export type CalendarRangeOutcome = { type: 'ok'; events: CalendarEvent[] } | { type: 'invalid_range' };

/** Enough for a six-week grid plus a margin; a year-long agenda would need paging. */
export const MAX_RANGE_DAYS = 100;
const MAX_EVENTS_PER_RANGE = 1000;
const DAY_MS = 86_400_000;

export type CalendarService = {
	/**
	 * Events overlapping `[from, to)` as seen from `timeZone`. The query is padded
	 * by a day each side because an all-day event's stored instants are UTC dates,
	 * not the zone's, and then filtered exactly.
	 */
	listBetween(userId: string, from: Date, to: Date, timeZone: string): Promise<CalendarRangeOutcome>;
	create(userId: string, input: CalendarEventInput): Promise<CalendarWriteOutcome>;
	update(userId: string, id: string, input: CalendarEventInput): Promise<CalendarWriteOutcome>;
	remove(userId: string, id: string): Promise<'ok' | 'read_only' | 'not_found'>;
};

export function createCalendarService({ repo }: { repo: CalendarRepository }): CalendarService {
	return {
		async listBetween(userId, from, to, timeZone) {
			const span = to.getTime() - from.getTime();
			if (!(span > 0) || span > MAX_RANGE_DAYS * DAY_MS) return { type: 'invalid_range' };

			const rows = await repo.listOverlapping(
				userId,
				new Date(from.getTime() - DAY_MS).toISOString(),
				new Date(to.getTime() + DAY_MS).toISOString(),
				MAX_EVENTS_PER_RANGE
			);
			const events = rows.filter((event) => {
				const interval = eventInterval(event, timeZone);
				return interval.start < to && interval.end > from;
			});
			return { type: 'ok', events };
		},

		async create(userId, input) {
			const valid = validateEventInput(input);
			if (!valid.ok) return { type: valid.error };

			const event: CalendarEvent = { id: crypto.randomUUID(), ...valid.value, source: 'manual', busy: true };
			await repo.insert({ ...valid.value, id: event.id, userId, source: 'manual' });
			return { type: 'ok', event };
		},

		async update(userId, id, input) {
			const existing = await repo.get(userId, id);
			if (!existing) return { type: 'not_found' };
			if (isReadOnlyEvent(existing)) return { type: 'read_only' };

			const valid = validateEventInput(input);
			if (!valid.ok) return { type: valid.error };
			if (!(await repo.updateManual(userId, id, valid.value))) return { type: 'not_found' };
			return { type: 'ok', event: { ...existing, ...valid.value } };
		},

		async remove(userId, id) {
			const existing = await repo.get(userId, id);
			if (!existing) return 'not_found';
			if (isReadOnlyEvent(existing)) return 'read_only';
			return (await repo.deleteManual(userId, id)) ? 'ok' : 'not_found';
		}
	};
}
