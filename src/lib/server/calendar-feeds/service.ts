import {
	MAX_FEEDS_PER_USER,
	normalizeFeedName,
	normalizeFeedUrl,
	type CalendarFeed
} from '../../calendar/feeds';
import { expandCalendar, type FeedEvent } from '../../calendar/ics';
import { ownEventId } from '../invitations/answers';
import type { LabelColor } from '../../mail/labels';
import type { CalendarFeedsRepository, StoredFeed } from './repository';
import { FeedFetchError } from './fetch';

/** How far back and ahead a sync keeps events. The future is what reservations need. */
const SYNC_PAST_DAYS = 60;
const SYNC_FUTURE_DAYS = 400;
const DAY_MS = 86_400_000;
/**
 * A cron-driven feed is refreshed at most this often. ICS has no push and
 * Google only republishes every few hours, so polling faster buys nothing;
 * "Sync now" covers the case where a change has to show up at once.
 */
export const FEED_REFRESH_MINUTES = 6 * 60;
/**
 * How stale a host's feeds may be when someone opens their booking page. A
 * claim in D1 makes this a ceiling: however many visitors arrive, each feed is
 * fetched at most once per window.
 */
export const BOOKING_REFRESH_MINUTES = 15;
/** Feeds refreshed per booking-page request, the same bound the cron uses per tick. */
const BOOKING_FEEDS_PER_REQUEST = 2;

type SyncResult = 'synced' | 'failed' | 'skipped';

/**
 * Identifies what a full sync was computed from. The day is part of it so the
 * expansion window still moves forward for a feed that never changes, and the
 * zone because floating times are read in it.
 */
async function syncKeyOf(text: string, at: Date, timeZone: string): Promise<string> {
	// Google stamps every event with the time of the fetch; hashing it would make
	// every fetch look like a change. Nothing reads DTSTAMP when expanding.
	const content = text
		.split('\n')
		// Property names are case-insensitive (RFC 5545).
		.filter((line) => line.slice(0, 7).toUpperCase() !== 'DTSTAMP')
		.join('\n');
	const bytes = new TextEncoder().encode(`${at.toISOString().slice(0, 10)}|${timeZone}|${content}`);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function minutesBefore(at: Date, minutes: number): string {
	return new Date(at.getTime() - minutes * 60_000).toISOString();
}

export type FeedWriteOutcome =
	| { type: 'ok'; feed: CalendarFeed }
	| { type: 'invalid_name' }
	| { type: 'invalid_url' }
	| { type: 'limit_reached' }
	| { type: 'not_found' };

export type CalendarFeedsService = {
	list(userId: string): Promise<CalendarFeed[]>;
	/** Subscribes and syncs straight away; a failed first sync still keeps the feed, with its error. */
	add(userId: string, input: { name: string; url: string; color: LabelColor }): Promise<FeedWriteOutcome>;
	update(userId: string, id: string, changes: { name?: string; color?: LabelColor }): Promise<FeedWriteOutcome>;
	remove(userId: string, id: string): Promise<boolean>;
	sync(userId: string, id: string): Promise<FeedWriteOutcome>;
	/** For the cron: refreshes up to `limit` feeds that are due. */
	syncDue(limit: number): Promise<{ synced: number; failed: number }>;
	/** For the booking page: refreshes the host's feeds older than `BOOKING_REFRESH_MINUTES`. */
	refreshStale(userId: string): Promise<void>;
};

export type CalendarFeedsServiceDeps = {
	repo: CalendarFeedsRepository;
	fetchFeed: (url: string) => Promise<string>;
	/** The zone floating feed times are read in — the owner's saved zone. */
	timeZoneOf: (userId: string) => Promise<string>;
	now?: () => Date;
};

export function toFeedView(feed: StoredFeed): CalendarFeed {
	let host = '';
	try {
		host = new URL(feed.url).hostname;
	} catch {
		// Stored URLs were validated on the way in; an unreadable one just shows no host.
	}
	return {
		id: feed.id,
		name: feed.name,
		color: feed.color,
		host,
		eventCount: feed.eventCount,
		lastSyncedAt: feed.lastSyncedAt,
		lastError: feed.lastError
	};
}

export function createCalendarFeedsService(deps: CalendarFeedsServiceDeps): CalendarFeedsService {
	const { repo } = deps;
	const now = deps.now ?? (() => new Date());

	/**
	 * Drops events that are the user's own Zimail events coming back: invite your
	 * own Gmail and Google adds the event to the very calendar this feed reads.
	 * Matched on the event's id, not just the UID suffix, so an invitation from
	 * someone else's Zimail still shows.
	 */
	async function withoutEchoes(userId: string, events: FeedEvent[]): Promise<FeedEvent[]> {
		// Occurrence uids are `<series uid>#<start>`; the series uid is what Zimail sent.
		const seriesOf = (uid: string) => (uid.includes('#') ? uid.slice(0, uid.lastIndexOf('#')) : uid);
		const idOf = (event: FeedEvent) => ownEventId(seriesOf(event.uid));
		const candidates = [...new Set(events.map(idOf).filter((id): id is string => id !== null))];
		if (candidates.length === 0) return events;
		const own = await repo.ownEventIds(userId, candidates);
		return events.filter((event) => {
			const id = idOf(event);
			return id === null || !own.has(id);
		});
	}

	/** Syncs one feed if the claim succeeds; `staleBefore` null claims unconditionally ("Sync now"). */
	async function runSync(feed: StoredFeed, staleBefore: string | null): Promise<SyncResult> {
		const at = now();
		if (!(await repo.claim(feed.id, at.toISOString(), staleBefore))) return 'skipped';

		try {
			const text = await deps.fetchFeed(feed.url);
			const timeZone = await deps.timeZoneOf(feed.userId);
			const syncKey = await syncKeyOf(text, at, timeZone);
			if (syncKey === feed.syncKey) {
				await repo.recordSync(feed.id, { syncedAt: at.toISOString(), error: null, eventCount: null, syncKey: null });
				return 'synced';
			}

			const events = await withoutEchoes(
				feed.userId,
				expandCalendar(text, {
					from: new Date(at.getTime() - SYNC_PAST_DAYS * DAY_MS),
					to: new Date(at.getTime() + SYNC_FUTURE_DAYS * DAY_MS),
					fallbackTimeZone: timeZone
				})
			);
			await repo.syncEvents(feed.userId, feed.id, events);
			await repo.recordSync(feed.id, { syncedAt: at.toISOString(), error: null, eventCount: events.length, syncKey });
			return 'synced';
		} catch (error) {
			// Only our own messages reach the UI; anything else might carry internals.
			const message = error instanceof FeedFetchError ? error.message : 'The calendar could not be read.';
			await repo.recordSync(feed.id, { syncedAt: null, error: message, eventCount: null, syncKey: null });
			return 'failed';
		}
	}

	async function syncAndView(userId: string, id: string): Promise<FeedWriteOutcome> {
		const feed = await repo.get(userId, id);
		if (!feed) return { type: 'not_found' };
		await runSync(feed, null);
		const updated = await repo.get(userId, id);
		return updated ? { type: 'ok', feed: toFeedView(updated) } : { type: 'not_found' };
	}

	return {
		async list(userId) {
			return (await repo.listForUser(userId)).map(toFeedView);
		},

		async add(userId, input) {
			const name = normalizeFeedName(input.name);
			if (!name) return { type: 'invalid_name' };
			const url = normalizeFeedUrl(input.url);
			if (!url) return { type: 'invalid_url' };
			if ((await repo.countForUser(userId)) >= MAX_FEEDS_PER_USER) return { type: 'limit_reached' };

			const id = crypto.randomUUID();
			await repo.insert({ id, userId, name, url, color: input.color });
			return syncAndView(userId, id);
		},

		async update(userId, id, changes) {
			const patch: { name?: string; color?: LabelColor } = {};
			if (changes.name !== undefined) {
				const name = normalizeFeedName(changes.name);
				if (!name) return { type: 'invalid_name' };
				patch.name = name;
			}
			if (changes.color !== undefined) patch.color = changes.color;
			if (Object.keys(patch).length > 0 && !(await repo.update(userId, id, patch))) return { type: 'not_found' };

			const feed = await repo.get(userId, id);
			return feed ? { type: 'ok', feed: toFeedView(feed) } : { type: 'not_found' };
		},

		remove: (userId, id) => repo.delete(userId, id),

		sync: syncAndView,

		async syncDue(limit) {
			const before = minutesBefore(now(), FEED_REFRESH_MINUTES);
			let synced = 0;
			let failed = 0;
			for (const feed of await repo.listDue(before, limit)) {
				const result = await runSync(feed, before);
				if (result === 'synced') synced++;
				else if (result === 'failed') failed++;
			}
			return { synced, failed };
		},

		async refreshStale(userId) {
			const before = minutesBefore(now(), BOOKING_REFRESH_MINUTES);
			for (const feed of await repo.listDueForUser(userId, before, BOOKING_FEEDS_PER_REQUEST)) {
				await runSync(feed, before);
			}
		}
	};
}
