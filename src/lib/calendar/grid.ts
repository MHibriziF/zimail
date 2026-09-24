/**
 * Laying events out on days. Every day boundary is the viewer's zone, never
 * the host's, so a server in UTC and a browser in Jakarta draw the same grid.
 */
import { instantFromWall, wallIn } from '$lib/timezone';
import { addDays, dateKeyToUtc, utcToDateKey, type CalendarEvent } from './events';

export type YearMonth = { year: number; month: number };

/** Most events are short; this only bounds a pathological one. */
const MAX_DAYS_PER_EVENT = 62;

const pad = (value: number) => String(value).padStart(2, '0');

export function dateKeyIn(instant: Date, timeZone: string): string {
	const wall = wallIn(instant, timeZone);
	return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The instant a zone's day begins. */
export function startOfDayIn(key: string, timeZone: string): Date {
	const date = dateKeyToUtc(key) ?? new Date(0);
	return instantFromWall(
		{ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() },
		timeZone
	);
}

/** 0 = Sunday. `Intl.Locale#weekInfo` isn't everywhere yet, so Monday is the fallback. */
export function firstDayOfWeek(locale: string): number {
	try {
		const info = (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay: number } }).weekInfo;
		if (info) return info.firstDay % 7;
	} catch {
		// Unknown tag — fall through.
	}
	return 1;
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
	const index = year * 12 + (month - 1) + delta;
	return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function formatMonthParam({ year, month }: YearMonth): string {
	return `${year}-${pad(month)}`;
}

export function parseMonthParam(value: string | null | undefined, fallback: YearMonth): YearMonth {
	const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
	if (!match) return fallback;
	const month = Number(match[2]);
	return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : fallback;
}

/** Six full weeks of `YYYY-MM-DD` keys covering the month. */
export function monthGrid({ year, month }: YearMonth, weekStart: number): string[] {
	const first = new Date(Date.UTC(year, month - 1, 1));
	const lead = (first.getUTCDay() - weekStart + 7) % 7;
	const start = addDays(utcToDateKey(first), -lead);
	return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** The dates an event touches in the zone. A timed event ending at midnight doesn't touch the next day. */
export function eventDateKeys(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>, timeZone: string): string[] {
	const first = event.allDay ? event.start.slice(0, 10) : dateKeyIn(new Date(event.start), timeZone);
	const last = event.allDay
		? addDays(event.end.slice(0, 10), -1)
		: dateKeyIn(new Date(Math.max(Date.parse(event.start), Date.parse(event.end) - 1)), timeZone);

	const keys = [first];
	for (let key = first; key < last && keys.length < MAX_DAYS_PER_EVENT; ) {
		key = addDays(key, 1);
		keys.push(key);
	}
	return keys;
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
	if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
	if (a.start !== b.start) return a.start < b.start ? -1 : 1;
	return a.title.localeCompare(b.title);
}

export function groupByDay(events: CalendarEvent[], timeZone: string): Map<string, CalendarEvent[]> {
	const byDay = new Map<string, CalendarEvent[]>();
	for (const event of [...events].sort(compareEvents)) {
		for (const key of eventDateKeys(event, timeZone)) {
			const list = byDay.get(key);
			if (list) list.push(event);
			else byDay.set(key, [event]);
		}
	}
	return byDay;
}
