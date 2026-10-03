import { addDays, MAX_EVENT_GUESTS } from '$lib/calendar/events';
import { instantFromWall } from '$lib/timezone';
import { localStamp } from './find';

/**
 * An event Ask AI prepared but did not save. The panel shows it with an "Add to calendar"
 * button, and only that click creates it, through the normal calendar API. The shape is
 * what that API takes, so the panel can send it as is.
 */
export type EventDraft = {
	title: string;
	/** An ISO instant, or a `YYYY-MM-DD` date when `allDay`. */
	start: string;
	/** Exclusive end, in the same form as `start`. */
	end: string;
	allDay: boolean;
	location: string | null;
	/** Saving the event emails each of them an invitation, so the panel lists them. */
	guests: string[];
	/** `YYYY-MM-DD` it starts on in the reader's zone, for linking to that day. */
	day: string;
	/** Busy events it overlaps, as "Title 09:00–09:30". */
	conflicts: string[];
};

export const CREATE_EVENT_TOOL = {
	type: 'function',
	function: {
		name: 'create_event',
		description:
			'Prepare a new event on the user\'s calendar. It is not saved: the user sees it with an "Add to calendar" button. Returns what was prepared and any busy events it overlaps.',
		parameters: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'Short name without the place, time or email addresses, like "Meetup with Izi" or "Dentist"' },
				date: { type: 'string', description: 'YYYY-MM-DD it starts on' },
				start_time: { type: 'string', description: 'HH:MM, 24-hour, in the user\'s time zone. Leave out only for an all-day event' },
				end_time: { type: 'string', description: 'HH:MM, 24-hour. Default 30 minutes after start_time' },
				all_day: { type: 'boolean', description: 'True for an event with no time, like a birthday or a day off' },
				location: { type: 'string', description: 'Where it happens, when the user names a place: "at Klinik Sehat" gives "Klinik Sehat"' },
				guests: { type: 'array', items: { type: 'string' }, description: 'Every email address the user asks to invite. Only addresses the user gave or that appear in their mail' }
			},
			required: ['title', 'date']
		}
	}
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{1,2}):(\d{2})$/;
const DEFAULT_MINUTES = 30;
const MAX_MINUTES = 24 * 60;
const TITLE_CHARS = 200;
const LOCATION_CHARS = 200;

function text(value: unknown): string {
	return typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : '';
}

/** Minutes after midnight, or null for anything that isn't a real `HH:MM`. */
function minutesOf(value: unknown): number | null {
	const match = TIME.exec(text(value));
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function isEmail(value: string): boolean {
	const at = value.indexOf('@');
	return at > 0 && at === value.lastIndexOf('@') && value.slice(at).includes('.') && !/[\s<>,]/.test(value);
}

function guestsOf(value: unknown): string[] {
	const listed = Array.isArray(value) ? value : text(value).split(',');
	const addresses = listed.map((entry) => text(entry).toLowerCase()).filter(isEmail);
	return [...new Set(addresses)].slice(0, MAX_EVENT_GUESTS);
}

/** How long a timed event runs: to `end_time` when it comes after the start, else the default. */
function durationOf(raw: Record<string, unknown>, start: number): number {
	const end = minutesOf(raw.end_time);
	const minutes = end !== null && end > start ? end - start : DEFAULT_MINUTES;
	return Math.min(minutes, MAX_MINUTES);
}

/** The model's arguments, made safe, or what it has to fix: it reads the error and tries again. */
export function eventDraft(raw: Record<string, unknown>, timeZone: string): EventDraft | { error: string } {
	const title = text(raw.title).slice(0, TITLE_CHARS);
	if (!title) return { error: 'Give the event a title.' };
	const day = text(raw.date);
	if (!DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return { error: 'Give the date as YYYY-MM-DD.' };

	const common = { title, location: text(raw.location).slice(0, LOCATION_CHARS) || null, guests: guestsOf(raw.guests), day, conflicts: [] };
	if (raw.all_day === true) return { ...common, start: day, end: addDays(day, 1), allDay: true };

	const start = minutesOf(raw.start_time);
	if (start === null) return { error: 'Ask the user what time it starts, or set all_day for an event with no time.' };
	const [year, month, date] = day.split('-').map(Number);
	const startAt = instantFromWall({ year, month, day: date, hour: Math.floor(start / 60), minute: start % 60 }, timeZone);
	const endAt = new Date(startAt.getTime() + durationOf(raw, start) * 60_000);
	return { ...common, start: startAt.toISOString(), end: endAt.toISOString(), allDay: false };
}

type Busy = { title: string; start: string; end: string; allDay: boolean; busy: boolean };

/** "Standup 09:00–09:30" in the reader's zone; just the title for an all-day event. */
function busyLabel(event: Busy, timeZone: string): string {
	if (event.allDay) return event.title;
	const time = (instant: string) => localStamp(instant, timeZone).split(' ')[2];
	return `${event.title} ${time(event.start)}–${time(event.end)}`;
}

/** Busy events that share time with the draft. An all-day draft counts as the whole UTC day. */
export function withConflicts(draft: EventDraft, events: Busy[], timeZone: string): EventDraft {
	const start = Date.parse(draft.start);
	const end = Date.parse(draft.end);
	const clashing = events.filter((event) => event.busy && Date.parse(event.start) < end && Date.parse(event.end) > start);
	return { ...draft, conflicts: clashing.map((event) => busyLabel(event, timeZone)) };
}

/** What the model hears back: enough to describe the draft, and that it isn't saved yet. */
export function draftForModel(draft: EventDraft, timeZone: string) {
	const when = draft.allDay
		? { date: draft.day, all_day: true }
		: { start: localStamp(draft.start, timeZone), end: localStamp(draft.end, timeZone) };
	return {
		prepared: true,
		title: draft.title,
		...when,
		location: draft.location,
		guests: draft.guests,
		...(draft.conflicts.length > 0 ? { overlaps: draft.conflicts } : {}),
		note:
			'Shown to the user with an "Add to calendar" button. It is NOT on the calendar, and no guest is invited, until they click it: say it is ready to add, never that it was created or that anyone was invited. Its guests are exactly the guests listed here.'
	};
}
