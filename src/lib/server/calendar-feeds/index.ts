import type { D1Database } from '@cloudflare/workers-types';
import { isValidTimeZone } from '../../timezone';
import { createD1CalendarFeedsRepository } from './repository';
import { createCalendarFeedsService, type CalendarFeedsService } from './service';
import { fetchFeedText } from './fetch';

export type { CalendarFeedsRepository } from './repository';
export { createCalendarFeedsService, type CalendarFeedsService, type FeedWriteOutcome } from './service';

/** Feeds refreshed per cron tick — each is a fetch plus a parse, and a tick has limits. */
const FEEDS_PER_TICK = 2;

export function calendarFeedsServiceForDb(db: D1Database): CalendarFeedsService {
	return createCalendarFeedsService({
		repo: createD1CalendarFeedsRepository(db),
		fetchFeed: (url) => fetchFeedText(url),
		async timeZoneOf(userId) {
			const row = await db
				.prepare('SELECT timezone FROM users WHERE id = ?')
				.bind(userId)
				.first<{ timezone: string | null }>();
			return row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : 'UTC';
		}
	});
}

/** Composition root for routes — mirrors `getCalendarService`. */
export function getCalendarFeedsService(platform: App.Platform | undefined | null): CalendarFeedsService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return calendarFeedsServiceForDb(db);
}

/** The cron's entry point. */
export function runDueFeedSyncs(db: D1Database) {
	return calendarFeedsServiceForDb(db).syncDue(FEEDS_PER_TICK);
}
