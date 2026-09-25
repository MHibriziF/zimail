/**
 * The event editor works in the viewer's wall time — separate date and time
 * fields — while the API speaks UTC instants. These convert between the two.
 */
import { instantFromWall, wallIn } from '../timezone';
import type { PartStat } from './ics/invite';
import {
	addDays,
	isPlausibleEmail,
	MAX_EVENT_GUESTS,
	type CalendarEvent,
	type CalendarEventInput,
	type EventGuest
} from './events';
import { dateKeyIn } from './grid';

export type EventDraft = {
	title: string;
	allDay: boolean;
	startDate: string;
	startTime: string;
	/** Inclusive for all-day events — the last day shown, not the day after. */
	endDate: string;
	endTime: string;
	location: string;
	notes: string;
	/** Guest addresses, or `null` when the list couldn't be loaded — then saving leaves it alone. */
	guests: string[] | null;
	withMeeting: boolean;
};

const GUEST_SEPARATORS = new Set([',', ';', ' ', '\t', '\n', '\r']);

/** What was typed or pasted into the guest field, as separate lowercased addresses. */
export function splitGuestInput(text: string): string[] {
	const found: string[] = [];
	let current = '';
	for (const char of text) {
		if (GUEST_SEPARATORS.has(char)) {
			if (current) found.push(current.toLowerCase());
			current = '';
		} else {
			current += char;
		}
	}
	if (current) found.push(current.toLowerCase());
	return found;
}

export type GuestEntry = { guests: string[]; error: { key: string; values: Record<string, string | number> } | null };

/** Adds what was typed to the list, or says why it can't be: the first bad address, or too many. */
export function addGuests(current: string[], text: string): GuestEntry {
	const typed = splitGuestInput(text);
	const invalid = typed.find((email) => !isPlausibleEmail(email));
	if (invalid) return { guests: current, error: { key: 'calendar.invalidGuest', values: { email: invalid } } };
	const guests = [...new Set([...current, ...typed])];
	if (guests.length > MAX_EVENT_GUESTS) {
		return { guests: current, error: { key: 'calendar.tooManyGuests', values: { max: MAX_EVENT_GUESTS } } };
	}
	return { guests, error: null };
}

const STATUS_KEYS: Partial<Record<PartStat, string>> = {
	accepted: 'calendar.guestAccepted',
	tentative: 'calendar.guestTentative',
	declined: 'calendar.guestDeclined'
};

/** The label for a guest's answer; someone not asked yet (just added) has none. */
export function guestStatusKey(status: PartStat | undefined): string | null {
	if (!status) return null;
	return STATUS_KEYS[status] ?? 'calendar.guestInvited';
}

const pad = (value: number) => String(value).padStart(2, '0');

function timeIn(instant: Date, timeZone: string): string {
	const wall = wallIn(instant, timeZone);
	return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** An hour-long event on `dayKey`, at the next whole hour when that's today, else 09:00. */
export function draftForNew(dayKey: string, timeZone: string, now = new Date()): EventDraft {
	const today = dateKeyIn(now, timeZone);
	const hour = dayKey === today ? Math.min(wallIn(now, timeZone).hour + 1, 23) : 9;
	return {
		title: '',
		allDay: false,
		startDate: dayKey,
		startTime: `${pad(hour)}:00`,
		endDate: hour === 23 ? addDays(dayKey, 1) : dayKey,
		endTime: `${pad((hour + 1) % 24)}:00`,
		location: '',
		notes: '',
		guests: [],
		withMeeting: false
	};
}

/** `guests` is the event's guest list, or `null` if it couldn't be loaded. */
export function draftFromEvent(event: CalendarEvent, timeZone: string, guests: EventGuest[] | null = []): EventDraft {
	const start = new Date(event.start);
	const end = new Date(event.end);
	const shared = {
		title: event.title,
		location: event.location ?? '',
		notes: event.notes ?? '',
		guests: guests?.map((guest) => guest.email) ?? null,
		withMeeting: event.meetingCode !== null
	};
	if (event.allDay) {
		return {
			...shared,
			allDay: true,
			startDate: event.start.slice(0, 10),
			startTime: '09:00',
			endDate: addDays(event.end.slice(0, 10), -1),
			endTime: '10:00'
		};
	}
	return {
		...shared,
		allDay: false,
		startDate: dateKeyIn(start, timeZone),
		startTime: timeIn(start, timeZone),
		endDate: dateKeyIn(end, timeZone),
		endTime: timeIn(end, timeZone)
	};
}

function wallInstant(date: string, time: string, timeZone: string): string {
	const [year, month, day] = date.split('-').map(Number);
	const [hour, minute] = time.split(':').map(Number);
	if (![year, month, day, hour, minute].every(Number.isFinite)) return '';
	return instantFromWall({ year, month, day, hour, minute }, timeZone).toISOString();
}

/** What the API takes. Bad dates become empty strings for the server to reject. */
export function draftToInput(draft: EventDraft, timeZone: string): CalendarEventInput {
	const base = {
		title: draft.title,
		allDay: draft.allDay,
		location: draft.location,
		notes: draft.notes,
		guests: draft.guests ?? undefined,
		withMeeting: draft.withMeeting
	};
	if (draft.allDay) return { ...base, start: draft.startDate, end: addDays(draft.endDate, 1) };
	return {
		...base,
		start: wallInstant(draft.startDate, draft.startTime, timeZone),
		end: wallInstant(draft.endDate, draft.endTime, timeZone)
	};
}
