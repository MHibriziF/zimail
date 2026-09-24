/**
 * ICS DATE / DATE-TIME / DURATION values.
 *
 * A time is kept as its *wall clock* (a naive epoch: `Date.UTC` of the digits)
 * plus the zone it's read in, because recurrences step in wall time — a weekly
 * 09:00 meeting stays at 09:00 across a DST change.
 */
import { instantFromWall, isValidTimeZone, wallIn } from '../../timezone';
import type { IcsProperty } from './parse';

export type IcsTime = {
	/** `Date.UTC(...)` of the wall-clock digits. */
	naive: number;
	/** A date with no time: a floating all-day value. */
	allDay: boolean;
	/** IANA zone the wall time is in; 'UTC' for `Z` times. Unused when `allDay`. */
	timeZone: string;
};

export const DAY_MS = 86_400_000;

/**
 * Outlook and Exchange publish Windows zone names. These are the common ones;
 * anything else unrecognised falls back to the calendar's own zone.
 */
const WINDOWS_ZONES: Record<string, string> = {
	'UTC': 'UTC',
	'GMT Standard Time': 'Europe/London',
	'Greenwich Standard Time': 'Atlantic/Reykjavik',
	'W. Europe Standard Time': 'Europe/Berlin',
	'Central Europe Standard Time': 'Europe/Budapest',
	'Romance Standard Time': 'Europe/Paris',
	'Central European Standard Time': 'Europe/Warsaw',
	'E. Europe Standard Time': 'Europe/Chisinau',
	'FLE Standard Time': 'Europe/Kiev',
	'GTB Standard Time': 'Europe/Bucharest',
	'Russian Standard Time': 'Europe/Moscow',
	'Turkey Standard Time': 'Europe/Istanbul',
	'Israel Standard Time': 'Asia/Jerusalem',
	'Arabian Standard Time': 'Asia/Dubai',
	'Arab Standard Time': 'Asia/Riyadh',
	'India Standard Time': 'Asia/Kolkata',
	'SE Asia Standard Time': 'Asia/Bangkok',
	'Singapore Standard Time': 'Asia/Singapore',
	'China Standard Time': 'Asia/Shanghai',
	'Taipei Standard Time': 'Asia/Taipei',
	'Tokyo Standard Time': 'Asia/Tokyo',
	'Korea Standard Time': 'Asia/Seoul',
	'AUS Eastern Standard Time': 'Australia/Sydney',
	'E. Australia Standard Time': 'Australia/Brisbane',
	'W. Australia Standard Time': 'Australia/Perth',
	'New Zealand Standard Time': 'Pacific/Auckland',
	'Eastern Standard Time': 'America/New_York',
	'Central Standard Time': 'America/Chicago',
	'Mountain Standard Time': 'America/Denver',
	'US Mountain Standard Time': 'America/Phoenix',
	'Pacific Standard Time': 'America/Los_Angeles',
	'Alaskan Standard Time': 'America/Anchorage',
	'Hawaiian Standard Time': 'Pacific/Honolulu',
	'Atlantic Standard Time': 'America/Halifax',
	'SA Pacific Standard Time': 'America/Bogota',
	'E. South America Standard Time': 'America/Sao_Paulo',
	'Argentina Standard Time': 'America/Buenos_Aires',
	'Mexico Standard Time': 'America/Mexico_City',
	'South Africa Standard Time': 'Africa/Johannesburg',
	'Egypt Standard Time': 'Africa/Cairo',
	'W. Central Africa Standard Time': 'Africa/Lagos'
};

/** A TZID as an IANA zone, or `null` if it can't be recognised. */
export function resolveTzid(tzid: string | undefined): string | null {
	if (!tzid) return null;
	const trimmed = tzid.trim();
	if (WINDOWS_ZONES[trimmed]) return WINDOWS_ZONES[trimmed];
	if (isValidTimeZone(trimmed)) return trimmed;
	// e.g. "/mozilla.org/20050126_1/Europe/Berlin" — try the trailing Area/City.
	const tail = trimmed.split('/').slice(-2).join('/');
	return isValidTimeZone(tail) ? tail : null;
}

const DIGITS = /^\d+$/;

/** One DATE (`20260924`) or DATE-TIME (`20260924T090000`, optionally `Z`). `zone` applies to times with neither `Z` nor their own TZID. */
export function parseTimeValue(value: string, zone: string): IcsTime | null {
	const text = value.trim();
	const utc = text.endsWith('Z');
	const [date, time = ''] = (utc ? text.slice(0, -1) : text).split('T');
	if (date.length !== 8 || !DIGITS.test(date) || (time && (time.length < 4 || !DIGITS.test(time)))) return null;

	const part = (source: string, from: number) => Number(source.slice(from, from + 2) || 0);
	const naive = Date.UTC(
		Number(date.slice(0, 4)),
		Number(date.slice(4, 6)) - 1,
		Number(date.slice(6, 8)),
		part(time, 0),
		part(time, 2),
		part(time, 4)
	);
	if (Number.isNaN(naive)) return null;
	if (!time) return { naive, allDay: true, timeZone: 'UTC' };
	return { naive, allDay: false, timeZone: utc ? 'UTC' : zone };
}

/** Every time in a DTSTART/EXDATE/RECURRENCE-ID property (EXDATE may list several). */
export function parseTimeProperty(property: IcsProperty, calendarZone: string): IcsTime[] {
	const zone = resolveTzid(property.params.TZID) ?? calendarZone;
	return property.value
		.split(',')
		.map((value) => parseTimeValue(value, zone))
		.filter((time): time is IcsTime => time !== null);
}

/** The real instant a time names. An all-day date is its floating UTC midnight. */
export function toInstant(time: IcsTime): Date {
	if (time.allDay || time.timeZone === 'UTC') return new Date(time.naive);
	const wall = new Date(time.naive);
	return instantFromWall(
		{
			year: wall.getUTCFullYear(),
			month: wall.getUTCMonth() + 1,
			day: wall.getUTCDate(),
			hour: wall.getUTCHours(),
			minute: wall.getUTCMinutes()
		},
		time.timeZone
	);
}

/** The naive wall reading of an instant in a zone — for comparing an UNTIL in `Z` against local occurrences. */
export function naiveIn(instant: Date, timeZone: string): number {
	const wall = wallIn(instant, timeZone);
	return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

const DURATION_UNITS: Record<string, number> = { W: 7 * DAY_MS, D: DAY_MS, H: 3_600_000, S: 1000 };

/** An ICS DURATION (`PT1H30M`, `P1D`, `-P1W`) in milliseconds, or `null` if unreadable. */
export function parseDuration(value: string): number | null {
	let text = value.trim();
	const negative = text.startsWith('-');
	if (negative || text.startsWith('+')) text = text.slice(1);
	if (!text.startsWith('P') || text.length < 3) return null;

	let ms = 0;
	let inTime = false;
	let digits = '';
	for (const char of text.slice(1)) {
		if (char >= '0' && char <= '9') {
			digits += char;
		} else if (char === 'T' && !digits) {
			inTime = true;
		} else {
			// M is minutes after the T; months don't exist in DURATION.
			const unit = char === 'M' && inTime ? 60_000 : DURATION_UNITS[char];
			if (!unit || !digits) return null;
			ms += Number(digits) * unit;
			digits = '';
		}
	}
	if (digits) return null;
	return negative ? -ms : ms;
}
