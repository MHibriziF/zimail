/**
 * Turns a published calendar (.ics) into the concrete occurrences inside a
 * window — what a feed sync stores. Recurring series are expanded, EXDATEs
 * removed, and moved or cancelled instances (RECURRENCE-ID) applied.
 */
import { first, parseIcs, unescapeText, type IcsComponent } from './parse';
import { parseRrule, expandRule } from './rrule';
import {
	DAY_MS,
	naiveIn,
	parseDuration,
	parseTimeProperty,
	parseTimeValue,
	resolveTzid,
	toInstant,
	type IcsTime
} from './time';

export type FeedEvent = {
	/** Stable per occurrence: the series UID plus the occurrence's original start. */
	uid: string;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	busy: boolean;
};

export type ExpandWindow = {
	from: Date;
	to: Date;
	/** For floating times when the calendar doesn't name its own zone. */
	fallbackTimeZone: string;
	limit?: number;
};

const DEFAULT_LIMIT = 2000;
const MAX_TITLE = 200;

type Series = {
	uid: string;
	start: IcsTime;
	/** Milliseconds; whole days for all-day events. */
	duration: number;
	component: IcsComponent;
};

/** Comparable identity of an occurrence's original start. */
function occurrenceKey(time: IcsTime): number {
	return time.allDay ? time.naive : toInstant(time).getTime();
}

function isCancelled(component: IcsComponent): boolean {
	return first(component, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED';
}

function readSeries(component: IcsComponent, zone: string): Series | null {
	const dtstart = first(component, 'DTSTART');
	const start = dtstart ? parseTimeProperty(dtstart, zone)[0] : undefined;
	if (!start) return null;

	const dtend = first(component, 'DTEND');
	const end = dtend ? parseTimeProperty(dtend, zone)[0] : undefined;
	const durationProperty = first(component, 'DURATION');
	let duration = start.allDay ? DAY_MS : 0;
	if (end) duration = start.allDay ? end.naive - start.naive : toInstant(end).getTime() - toInstant(start).getTime();
	else if (durationProperty) duration = parseDuration(durationProperty.value) ?? duration;
	if (start.allDay) duration = Math.max(1, Math.round(duration / DAY_MS)) * DAY_MS;

	const uid = first(component, 'UID')?.value.trim() || `${first(component, 'SUMMARY')?.value ?? ''}@${start.naive}`;
	return { uid, start, duration: Math.max(0, duration), component };
}

function toFeedEvent(series: Series, start: IcsTime): FeedEvent {
	const begins = toInstant(start);
	const summary = first(series.component, 'SUMMARY')?.value;
	const location = first(series.component, 'LOCATION')?.value;
	const transparent = first(series.component, 'TRANSP')?.value.trim().toUpperCase() === 'TRANSPARENT';
	return {
		uid: `${series.uid}#${occurrenceKey(start)}`,
		title: (summary ? unescapeText(summary).trim() : '').slice(0, MAX_TITLE) || 'Busy',
		start: begins.toISOString(),
		end: new Date(begins.getTime() + series.duration).toISOString(),
		allDay: start.allDay,
		location: location ? unescapeText(location).trim().slice(0, MAX_TITLE) || null : null,
		busy: !transparent
	};
}

function untilNaive(value: string | null, start: IcsTime): number | null {
	if (!value) return null;
	const until = parseTimeValue(value, start.timeZone);
	if (!until) return null;
	if (until.allDay) return until.naive + DAY_MS - 1;
	// A `Z` UNTIL is an instant; occurrences are compared in the series' own wall time.
	if (until.timeZone === 'UTC' && !start.allDay) return naiveIn(new Date(until.naive), start.timeZone);
	return until.naive;
}

function wallBound(instant: Date, start: IcsTime): number {
	return start.allDay ? instant.getTime() : naiveIn(instant, start.timeZone);
}

function occurrencesOf(series: Series, window: ExpandWindow, skip: Set<number>, limit: number): IcsTime[] {
	const rruleProperty = first(series.component, 'RRULE');
	const rule = rruleProperty ? parseRrule(rruleProperty.value) : null;
	if (!rule) return [series.start];

	const starts = expandRule(rule, {
		start: series.start.naive,
		until: untilNaive(rule.until, series.start),
		horizon: wallBound(window.to, series.start) + DAY_MS,
		notBefore: wallBound(window.from, series.start) - series.duration - DAY_MS,
		limit
	});
	return starts
		.map((naive) => ({ ...series.start, naive }))
		.filter((time) => !skip.has(occurrenceKey(time)));
}

function exdatesOf(component: IcsComponent, zone: string): number[] {
	return (component.get('EXDATE') ?? []).flatMap((property) => parseTimeProperty(property, zone).map(occurrenceKey));
}

type Sorted = {
	/** Series (or one-off events), cancelled ones dropped. */
	masters: Series[];
	/** Individually moved instances, which stand on their own. */
	overrides: Series[];
	/** Original starts of moved or cancelled instances, keyed by their series. */
	replaced: Map<string, Set<number>>;
};

function sortComponents(components: IcsComponent[], zone: string): Sorted {
	const sorted: Sorted = { masters: [], overrides: [], replaced: new Map() };
	for (const component of components) {
		const series = readSeries(component, zone);
		if (!series) continue;
		const recurrenceId = first(component, 'RECURRENCE-ID');
		const keep = !isCancelled(component);
		if (!recurrenceId) {
			if (keep) sorted.masters.push(series);
			continue;
		}
		const keys = sorted.replaced.get(series.uid) ?? new Set<number>();
		for (const key of parseTimeProperty(recurrenceId, zone).map(occurrenceKey)) keys.add(key);
		sorted.replaced.set(series.uid, keys);
		if (keep) sorted.overrides.push(series);
	}
	return sorted;
}

export function expandCalendar(text: string, window: ExpandWindow): FeedEvent[] {
	const limit = window.limit ?? DEFAULT_LIMIT;
	const calendar = parseIcs(text);
	const zone = resolveTzid(calendar.timeZone ?? undefined) ?? window.fallbackTimeZone;
	const { masters, overrides: singles, replaced } = sortComponents(calendar.events, zone);

	const events: FeedEvent[] = [];
	for (const series of masters) {
		const skip = new Set([...exdatesOf(series.component, zone), ...(replaced.get(series.uid) ?? [])]);
		for (const start of occurrencesOf(series, window, skip, limit)) events.push(toFeedEvent(series, start));
	}
	for (const series of singles) {
		// The override's UID matches its series; its own start keeps the occurrence id distinct.
		events.push(toFeedEvent(series, series.start));
	}

	// All-day dates are floating, so give them a day's slack either side of the window.
	const from = window.from.getTime() - DAY_MS;
	const to = window.to.getTime() + DAY_MS;
	return events
		.filter((event) => Date.parse(event.start) < to && Date.parse(event.end) > from)
		.sort((a, b) => a.start.localeCompare(b.start))
		.slice(0, limit);
}
