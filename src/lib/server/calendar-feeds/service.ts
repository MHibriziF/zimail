import {
	MAX_FEEDS_PER_USER,
	normalizeFeedName,
	normalizeFeedUrl,
	type CalendarFeed
} from '../../calendar/feeds';
import { expandCalendar } from '../../calendar/ics';
import type { LabelColor } from '../../mail/labels';
import type { CalendarFeedsRepository, StoredFeed } from './repository';
import { FeedFetchError } from './fetch';

/** How far back and ahead a sync keeps events. The future is what reservations need. */
const SYNC_PAST_DAYS = 60;
const SYNC_FUTURE_DAYS = 400;
const DAY_MS = 86_400_000;
/** A cron-driven feed is refreshed at most this often. Google itself only republishes every few hours. */
export const FEED_REFRESH_MINUTES = 30;

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

	async function runSync(feed: StoredFeed): Promise<boolean> {
		const at = now();
		try {
			const text = await deps.fetchFeed(feed.url);
			const events = expandCalendar(text, {
				from: new Date(at.getTime() - SYNC_PAST_DAYS * DAY_MS),
				to: new Date(at.getTime() + SYNC_FUTURE_DAYS * DAY_MS),
				fallbackTimeZone: await deps.timeZoneOf(feed.userId)
			});
			await repo.replaceEvents(feed.userId, feed.id, events);
			await repo.recordSync(feed.id, {
				attemptedAt: at.toISOString(),
				syncedAt: at.toISOString(),
				error: null,
				eventCount: events.length
			});
			return true;
		} catch (error) {
			// Only our own messages reach the UI; anything else might carry internals.
			const message = error instanceof FeedFetchError ? error.message : 'The calendar could not be read.';
			await repo.recordSync(feed.id, { attemptedAt: at.toISOString(), syncedAt: null, error: message, eventCount: null });
			return false;
		}
	}

	async function syncAndView(userId: string, id: string): Promise<FeedWriteOutcome> {
		const feed = await repo.get(userId, id);
		if (!feed) return { type: 'not_found' };
		await runSync(feed);
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
			const before = new Date(now().getTime() - FEED_REFRESH_MINUTES * 60_000).toISOString();
			let synced = 0;
			let failed = 0;
			for (const feed of await repo.listDue(before, limit)) {
				if (await runSync(feed)) synced++;
				else failed++;
			}
			return { synced, failed };
		}
	};
}
