/**
 * Which reservation slots are free. Pure: the caller supplies the busy time
 * (every busy calendar event, feeds and earlier bookings included) and "now".
 */
import { instantFromWall } from '../timezone';
import { addDays, dateKeyToUtc } from './events';
import type { ReservationPageSettings } from './reservations';

export type Interval = { start: Date; end: Date };

export type DaySlots = {
	/** `YYYY-MM-DD` in the page's zone. */
	date: string;
	/** UTC ISO starts of the free slots. */
	slots: string[];
};

type SlotRules = Pick<
	ReservationPageSettings,
	'timeZone' | 'startDate' | 'endDate' | 'weekdays' | 'dayStart' | 'dayEnd' | 'slotMinutes' | 'bufferMinutes' | 'noticeMinutes'
>;

const MINUTE_MS = 60_000;

function overlapsAny(start: number, end: number, busy: Interval[]): boolean {
	return busy.some((interval) => interval.start.getTime() < end && interval.end.getTime() > start);
}

function slotsOn(key: string, page: SlotRules, busy: Interval[], earliest: number): string[] {
	const date = dateKeyToUtc(key);
	if (!date || !page.weekdays.includes(date.getUTCDay())) return [];

	const wall = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
	const buffer = page.bufferMinutes * MINUTE_MS;
	const slots: string[] = [];
	for (let minute = page.dayStart; minute + page.slotMinutes <= page.dayEnd; minute += page.slotMinutes) {
		const start = instantFromWall({ ...wall, hour: Math.floor(minute / 60), minute: minute % 60 }, page.timeZone).getTime();
		const end = start + page.slotMinutes * MINUTE_MS;
		if (start >= earliest && !overlapsAny(start - buffer, end + buffer, busy)) {
			slots.push(new Date(start).toISOString());
		}
	}
	return slots;
}

/** Free slots for `days` days from `fromKey`, clipped to the page's window. */
export function computeSlots(
	page: SlotRules,
	busy: Interval[],
	options: { fromKey: string; days: number; now: Date }
): DaySlots[] {
	const earliest = options.now.getTime() + page.noticeMinutes * MINUTE_MS;
	const out: DaySlots[] = [];
	for (let index = 0; index < options.days; index++) {
		const key = addDays(options.fromKey, index);
		if (key < page.startDate || key > page.endDate) continue;
		out.push({ date: key, slots: slotsOn(key, page, busy, earliest) });
	}
	return out;
}

/** Whether `start` is exactly one of the free slots — the server's re-check at booking time. */
export function isFreeSlot(page: SlotRules, busy: Interval[], start: Date, now: Date, dateKey: string): boolean {
	const [day] = computeSlots(page, busy, { fromKey: dateKey, days: 1, now });
	return day?.slots.includes(start.toISOString()) ?? false;
}
