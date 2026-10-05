import type { CalendarEvent } from '../../calendar/events';
import { publishedCalendar, type PublishedEvent } from '../../calendar/ics/publish';
import type { PublishOptions, PublishStatus } from '../../calendar/publish';
import type { CalendarPublishRepository } from './repository';

const DAY_MS = 86_400_000;
/** What the feed covers: recent history, and the coming year. */
export const WINDOW_BACK_DAYS = 90;
export const WINDOW_AHEAD_DAYS = 365;
/** A cached file is rebuilt after this even when nothing changed, so its window moves with time. */
export const CACHE_MAX_AGE_MS = 7 * DAY_MS;
const MAX_EVENTS = 5_000;

export type CalendarPublishService = {
	status(userId: string): Promise<PublishStatus>;
	/** Starts publishing, or replaces the link. The token is only ever returned here. */
	publish(userId: string): Promise<{ token: string }>;
	setOptions(userId: string, options: PublishOptions): Promise<'ok' | 'not_published'>;
	unpublish(userId: string): Promise<void>;
	/** The feed behind a link's token, or `null` when no feed has it. */
	feed(token: string): Promise<string | null>;
};

export type CalendarPublishDeps = {
	repo: CalendarPublishRepository;
	listEvents(userId: string, from: string, to: string, options: { includeFeeds: boolean; limit: number }): Promise<CalendarEvent[]>;
	hashToken(token: string): Promise<string>;
	createToken(): string;
	meetingUrl(code: string): string | null;
	calendarName: string;
	busyLabel: string;
	now?: () => Date;
};

function toPublished(event: CalendarEvent, meetingUrl: (code: string) => string | null): PublishedEvent {
	return {
		id: event.id,
		title: event.title,
		start: event.start,
		end: event.end,
		allDay: event.allDay,
		location: event.location,
		notes: event.notes,
		busy: event.busy,
		meetingUrl: event.meetingCode ? meetingUrl(event.meetingCode) : null
	};
}

export function isFresh(ics: string | null, builtAt: string | null, now: Date): ics is string {
	if (!ics || !builtAt) return false;
	return now.getTime() - Date.parse(builtAt) < CACHE_MAX_AGE_MS;
}

export function createCalendarPublishService(deps: CalendarPublishDeps): CalendarPublishService {
	const now = deps.now ?? (() => new Date());

	return {
		async status(userId) {
			const options = await deps.repo.options(userId);
			return options ? { published: true, ...options } : { published: false };
		},

		async publish(userId) {
			const token = deps.createToken();
			await deps.repo.setToken(userId, await deps.hashToken(token));
			return { token };
		},

		async setOptions(userId, options) {
			return (await deps.repo.setOptions(userId, options)) ? 'ok' : 'not_published';
		},

		unpublish(userId) {
			return deps.repo.remove(userId);
		},

		async feed(token) {
			const row = await deps.repo.findByTokenHash(await deps.hashToken(token));
			if (!row) return null;
			const at = now();
			if (isFresh(row.ics, row.builtAt, at)) return row.ics;

			await deps.repo.markBuilding(row.userId);
			const from = new Date(at.getTime() - WINDOW_BACK_DAYS * DAY_MS).toISOString();
			const to = new Date(at.getTime() + WINDOW_AHEAD_DAYS * DAY_MS).toISOString();
			const events = await deps.listEvents(row.userId, from, to, { includeFeeds: row.includeFeeds, limit: MAX_EVENTS });
			const ics = publishedCalendar(
				events.map((event) => toPublished(event, deps.meetingUrl)),
				{ calendarName: deps.calendarName, busyOnly: row.busyOnly, busyLabel: deps.busyLabel, now: at }
			);
			await deps.repo.saveBuilt(row.userId, ics, at.toISOString());
			return ics;
		}
	};
}
