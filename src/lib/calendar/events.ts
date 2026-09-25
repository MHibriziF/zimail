/**
 * Calendar event rules shared by the server (which enforces them) and the
 * editor (which checks the same things before a request is made).
 */
import { instantFromWall } from '../timezone';
import type { LabelColor } from '../mail/labels';
import type { PartStat } from './ics/invite';

export const CALENDAR_EVENT_SOURCES = ['manual', 'feed', 'reservation', 'invite'] as const;
export type CalendarEventSource = (typeof CALENDAR_EVENT_SOURCES)[number];

export const MAX_EVENT_TITLE_LENGTH = 200;
export const MAX_EVENT_LOCATION_LENGTH = 200;
export const MAX_EVENT_NOTES_LENGTH = 4000;
/** Each guest is one email per change, so the list stays small. */
export const MAX_EVENT_GUESTS = 30;
const MAX_EVENT_DAYS = 366;
const DAY_MS = 86_400_000;

export type CalendarEvent = {
	id: string;
	title: string;
	/** UTC ISO instant — or, for an all-day event, midnight UTC of its first date. */
	start: string;
	/** Exclusive: the instant it ends, or midnight UTC of the day after its last date. */
	end: string;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	source: CalendarEventSource;
	/** False for time marked free (a feed's TRANSP:TRANSPARENT) — shown, but blocks nothing. */
	busy: boolean;
	/** The subscribed calendar a feed event came from, for its color and label. */
	calendar: { name: string; color: LabelColor } | null;
	/** The join code of the event's own Zimail meeting room, if it has one. */
	meetingCode: string | null;
};

export type CalendarEventInput = {
	title: string;
	/** An ISO instant, or a `YYYY-MM-DD` date when `allDay`. */
	start: string;
	/** Exclusive end, in the same form as `start`. */
	end: string;
	allDay: boolean;
	location?: string | null;
	notes?: string | null;
	/** Email addresses to invite; left out, the guest list stays as it is. */
	guests?: string[];
	/** Whether the event has its own meeting room; left out, it stays as it is. */
	withMeeting?: boolean;
};

export type ValidEventInput = {
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	notes: string | null;
};

export type EventInputError = 'invalid_title' | 'invalid_time';

/** Someone invited to one of the user's events, and what their calendar last answered. */
export type EventGuest = { email: string; name: string | null; status: PartStat };

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → midnight UTC of that date, or `null` if it isn't a real date. */
export function dateKeyToUtc(key: string): Date | null {
	const match = DATE_KEY.exec(key);
	if (!match) return null;
	const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
	return date.toISOString().startsWith(key) ? date : null;
}

export function utcToDateKey(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function addDays(key: string, days: number): string {
	const date = dateKeyToUtc(key);
	if (!date) return key;
	return utcToDateKey(new Date(date.getTime() + days * DAY_MS));
}

function cleanText(value: string | null | undefined, max: number): string | null {
	const text = (value ?? '').trim().slice(0, max).trim();
	return text || null;
}

const FORBIDDEN_IN_EMAIL = new Set([' ', '\t', '\r', '\n', '<', '>', ',', ';', '"']);

/**
 * Deliberately loose — the provider is the real judge — but it keeps out junk
 * and anything that could smuggle a second recipient or header. Hand-rolled
 * rather than a regex, which Sonar scores as backtracking-prone.
 */
export function isPlausibleEmail(email: string): boolean {
	if (email.length > 254 || [...email].some((char) => FORBIDDEN_IN_EMAIL.has(char))) return false;
	const at = email.indexOf('@');
	if (at < 1 || at !== email.lastIndexOf('@')) return false;
	const domain = email.slice(at + 1);
	const dot = domain.lastIndexOf('.');
	return dot > 0 && dot < domain.length - 1;
}

/** Lowercased and deduplicated; `null` if any address is unusable or there are too many. */
export function validateGuests(emails: readonly string[]): string[] | null {
	const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
	if (unique.length > MAX_EVENT_GUESTS || !unique.every(isPlausibleEmail)) return null;
	return unique;
}

function parseBound(value: string, allDay: boolean): Date | null {
	if (allDay) return dateKeyToUtc(value.slice(0, 10));
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function validateEventInput(
	input: CalendarEventInput
): { ok: true; value: ValidEventInput } | { ok: false; error: EventInputError } {
	const title = cleanText(input.title.replaceAll(/\s+/g, ' '), MAX_EVENT_TITLE_LENGTH);
	if (!title) return { ok: false, error: 'invalid_title' };

	const start = parseBound(input.start, input.allDay);
	const end = parseBound(input.end, input.allDay);
	if (!start || !end) return { ok: false, error: 'invalid_time' };
	const length = end.getTime() - start.getTime();
	if (length <= 0 || length > MAX_EVENT_DAYS * DAY_MS) return { ok: false, error: 'invalid_time' };

	return {
		ok: true,
		value: {
			title,
			start: start.toISOString(),
			end: end.toISOString(),
			allDay: input.allDay,
			location: cleanText(input.location, MAX_EVENT_LOCATION_LENGTH),
			notes: cleanText(input.notes, MAX_EVENT_NOTES_LENGTH)
		}
	};
}

/**
 * The real instants an event occupies as seen from `timeZone`. All-day events
 * are floating dates, so they cover that zone's midnight to midnight.
 */
export function eventInterval(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>, timeZone: string) {
	if (!event.allDay) return { start: new Date(event.start), end: new Date(event.end) };
	const wall = (iso: string) => {
		const date = new Date(iso);
		return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
	};
	return { start: instantFromWall(wall(event.start), timeZone), end: instantFromWall(wall(event.end), timeZone) };
}

export function isReadOnlyEvent(event: Pick<CalendarEvent, 'source'>): boolean {
	return event.source !== 'manual';
}

/**
 * A booking can't be edited but can be cancelled, and an invitation can be
 * taken off; a feed event belongs to the other calendar.
 */
export function isDeletableEvent(event: Pick<CalendarEvent, 'source'>): boolean {
	return event.source !== 'feed';
}
