/**
 * The event editor works in the viewer's wall time — separate date and time
 * fields — while the API speaks UTC instants. These convert between the two.
 */
import { instantFromWall, wallIn } from '$lib/timezone';
import { addDays, type CalendarEvent, type CalendarEventInput } from './events';
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
};

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
		notes: ''
	};
}

export function draftFromEvent(event: CalendarEvent, timeZone: string): EventDraft {
	const start = new Date(event.start);
	const end = new Date(event.end);
	const shared = { title: event.title, location: event.location ?? '', notes: event.notes ?? '' };
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
	const base = { title: draft.title, allDay: draft.allDay, location: draft.location, notes: draft.notes };
	if (draft.allDay) return { ...base, start: draft.startDate, end: addDays(draft.endDate, 1) };
	return {
		...base,
		start: wallInstant(draft.startDate, draft.startTime, timeZone),
		end: wallInstant(draft.endDate, draft.endTime, timeZone)
	};
}
