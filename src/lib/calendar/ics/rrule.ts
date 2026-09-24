/**
 * RRULE expansion for the rules calendars actually publish: DAILY, WEEKLY,
 * MONTHLY and YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (with ordinals),
 * BYMONTHDAY, BYMONTH, BYSETPOS and WKST. Hourly-and-finer frequencies and
 * BYWEEKNO/BYYEARDAY are not supported; such rules yield only their first
 * occurrence.
 *
 * Works on naive wall times (see `./time.ts`), so the caller decides zones.
 */
import { DAY_MS } from './time';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
type WeekdayRule = { weekday: number; ordinal: number };

export type RecurrenceRule = {
	freq: Frequency;
	interval: number;
	count: number | null;
	/** The raw UNTIL value; the caller converts it, since it may be UTC or a date. */
	until: string | null;
	byDay: WeekdayRule[];
	byMonthDay: number[];
	byMonth: number[];
	bySetPos: number[];
	/** 0 = Sunday. */
	weekStart: number;
};

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQUENCIES: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
/** A rule that runs this many periods without ending is almost certainly unbounded; stop. */
const MAX_PERIODS = 20_000;

function numbers(value: string | undefined): number[] {
	if (!value) return [];
	return value
		.split(',')
		.map(Number)
		.filter((n) => Number.isInteger(n) && n !== 0);
}

function parseByDay(value: string | undefined): WeekdayRule[] {
	if (!value) return [];
	const rules: WeekdayRule[] = [];
	for (const entry of value.split(',')) {
		const code = entry.slice(-2).toUpperCase();
		const weekday = WEEKDAYS.indexOf(code);
		const ordinal = entry.length > 2 ? Number(entry.slice(0, -2)) : 0;
		if (weekday >= 0 && Number.isInteger(ordinal)) rules.push({ weekday, ordinal });
	}
	return rules;
}

export function parseRrule(value: string): RecurrenceRule | null {
	const parts = new Map<string, string>();
	for (const pair of value.split(';')) {
		const eq = pair.indexOf('=');
		if (eq > 0) parts.set(pair.slice(0, eq).toUpperCase(), pair.slice(eq + 1));
	}
	const freq = FREQUENCIES.find((entry) => entry === parts.get('FREQ')?.toUpperCase());
	if (!freq) return null;

	const interval = Number(parts.get('INTERVAL') ?? 1);
	const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null;
	const weekStart = WEEKDAYS.indexOf((parts.get('WKST') ?? 'MO').toUpperCase());
	return {
		freq,
		interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
		count: count !== null && Number.isInteger(count) && count > 0 ? count : null,
		until: parts.get('UNTIL') ?? null,
		byDay: parseByDay(parts.get('BYDAY')),
		byMonthDay: numbers(parts.get('BYMONTHDAY')),
		byMonth: numbers(parts.get('BYMONTH')).filter((month) => month >= 1 && month <= 12),
		bySetPos: numbers(parts.get('BYSETPOS')),
		weekStart: weekStart >= 0 ? weekStart : 1
	};
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `n`th entry of a list, 1-based from the start or negative from the end. */
function pick<T>(list: T[], n: number): T | undefined {
	return n > 0 ? list[n - 1] : list[list.length + n];
}

/** The days of one month the rule selects, as day-of-month numbers. */
function monthDays(rule: RecurrenceRule, year: number, month: number, anchorDay: number): number[] {
	const length = daysInMonth(year, month);
	const weekdayOf = (day: number) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	const all = Array.from({ length }, (_, index) => index + 1);

	let days: number[];
	if (rule.byMonthDay.length > 0) {
		days = rule.byMonthDay.map((day) => (day > 0 ? day : length + day + 1)).filter((day) => day >= 1 && day <= length);
		if (rule.byDay.length > 0) days = days.filter((day) => rule.byDay.some((entry) => entry.weekday === weekdayOf(day)));
	} else if (rule.byDay.length > 0) {
		days = rule.byDay.flatMap((entry) => {
			const matching = all.filter((day) => weekdayOf(day) === entry.weekday);
			if (entry.ordinal === 0) return matching;
			const chosen = pick(matching, entry.ordinal);
			return chosen === undefined ? [] : [chosen];
		});
	} else {
		days = anchorDay <= length ? [anchorDay] : [];
	}
	return [...new Set(days)].sort((a, b) => a - b);
}

function applySetPos(rule: RecurrenceRule, candidates: number[]): number[] {
	if (rule.bySetPos.length === 0) return candidates;
	return rule.bySetPos
		.map((position) => pick(candidates, position))
		.filter((value): value is number => value !== undefined)
		.sort((a, b) => a - b);
}

type Anchor = { year: number; month: number; day: number; weekday: number };

const inMonths = (rule: RecurrenceRule, month: number) => rule.byMonth.length === 0 || rule.byMonth.includes(month);

function dailyDays(rule: RecurrenceRule, anchor: Anchor, step: number): number[] {
	const candidate = Date.UTC(anchor.year, anchor.month - 1, anchor.day + step);
	const date = new Date(candidate);
	const weekdayOk = rule.byDay.length === 0 || rule.byDay.some((entry) => entry.weekday === date.getUTCDay());
	return weekdayOk && inMonths(rule, date.getUTCMonth() + 1) ? [candidate] : [];
}

function weeklyDays(rule: RecurrenceRule, anchor: Anchor, step: number): number[] {
	const lead = (anchor.weekday - rule.weekStart + 7) % 7;
	const weekBegins = Date.UTC(anchor.year, anchor.month - 1, anchor.day - lead + step * 7);
	const weekdays = rule.byDay.length > 0 ? rule.byDay.map((entry) => entry.weekday) : [anchor.weekday];
	const days = [...new Set(weekdays)]
		.map((weekday) => weekBegins + ((weekday - rule.weekStart + 7) % 7) * DAY_MS)
		.filter((candidate) => inMonths(rule, new Date(candidate).getUTCMonth() + 1))
		.sort((a, b) => a - b);
	return applySetPos(rule, days);
}

function monthlyDays(rule: RecurrenceRule, anchor: Anchor, step: number): number[] {
	const target = new Date(Date.UTC(anchor.year, anchor.month - 1 + step, 1));
	const year = target.getUTCFullYear();
	const month = target.getUTCMonth() + 1;
	if (!inMonths(rule, month)) return [];
	return applySetPos(
		rule,
		monthDays(rule, year, month, anchor.day).map((day) => Date.UTC(year, month - 1, day))
	);
}

function yearlyDays(rule: RecurrenceRule, anchor: Anchor, step: number): number[] {
	const year = anchor.year + step;
	const months = rule.byMonth.length > 0 ? rule.byMonth : [anchor.month];
	const days = months.flatMap((month) =>
		monthDays(rule, year, month, anchor.day).map((day) => Date.UTC(year, month - 1, day))
	);
	return applySetPos(rule, days.sort((a, b) => a - b));
}

const PERIOD_DAYS = { DAILY: dailyDays, WEEKLY: weeklyDays, MONTHLY: monthlyDays, YEARLY: yearlyDays };

/** A naive time no later than anything period `step` can produce — for stopping on empty periods. */
function periodFloor(rule: RecurrenceRule, anchor: Anchor, step: number): number {
	switch (rule.freq) {
		case 'DAILY':
			return Date.UTC(anchor.year, anchor.month - 1, anchor.day + step);
		case 'WEEKLY':
			return Date.UTC(anchor.year, anchor.month - 1, anchor.day + step * 7 - 7);
		case 'MONTHLY':
			return Date.UTC(anchor.year, anchor.month - 1 + step, 1);
		case 'YEARLY':
			return Date.UTC(anchor.year + step, 0, 1);
	}
}

export type ExpandOptions = {
	/** Naive wall time of DTSTART. */
	start: number;
	/** Naive wall time the last occurrence may start at (from UNTIL), if any. */
	until: number | null;
	/** Stop once occurrences start after this naive time. */
	horizon: number;
	/** Occurrences starting before this naive time are counted (for COUNT) but not returned. */
	notBefore: number;
	/** Hard cap on returned occurrences. */
	limit: number;
};

/** Naive start times of the occurrences in `[notBefore, horizon]`, DTSTART included. */
export function expandRule(rule: RecurrenceRule, options: ExpandOptions): number[] {
	const startDate = new Date(options.start);
	const timeOfDay = options.start - Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
	const last = Math.min(options.horizon, options.until ?? Infinity);
	const out: number[] = [];
	let seen = 0;

	const take = (occurrence: number): boolean => {
		seen++;
		if (occurrence >= options.notBefore) out.push(occurrence);
		return (rule.count !== null && seen >= rule.count) || out.length >= options.limit;
	};

	// DTSTART is always the first occurrence, whether or not the rule would pick it.
	if (options.start > last || take(options.start)) return out;

	const anchor: Anchor = {
		year: startDate.getUTCFullYear(),
		month: startDate.getUTCMonth() + 1,
		day: startDate.getUTCDate(),
		weekday: startDate.getUTCDay()
	};
	for (let index = 0; index < MAX_PERIODS; index++) {
		const step = index * rule.interval;
		if (periodFloor(rule, anchor, step) > last) return out;
		for (const day of PERIOD_DAYS[rule.freq](rule, anchor, step)) {
			const occurrence = day + timeOfDay;
			if (occurrence <= options.start) continue;
			if (occurrence > last) return out;
			if (take(occurrence)) return out;
		}
	}
	return out;
}
