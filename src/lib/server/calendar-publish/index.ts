import type { D1Database } from '@cloudflare/workers-types';
import { APP_NAME } from '../../constants';
import { createD1CalendarRepository } from '../calendar';
import { createLinkToken, hashToken } from '../util/crypto';
import { createD1CalendarPublishRepository } from './repository';
import { createCalendarPublishService, type CalendarPublishService } from './service';

export { createCalendarPublishService, type CalendarPublishService } from './service';
export { PUBLISHED_FEED_PREFIX, publishedFeedUrl } from './paths';

export function calendarPublishServiceForDb(
	db: D1Database,
	options: { baseUrl?: string; busyLabel?: string } = {}
): CalendarPublishService {
	const events = createD1CalendarRepository(db);
	return createCalendarPublishService({
		repo: createD1CalendarPublishRepository(db),
		listEvents: (userId, from, to, listOptions) => events.listStarting(userId, from, to, listOptions),
		hashToken,
		createToken: createLinkToken,
		meetingUrl: (code) => (options.baseUrl ? new URL(`/meet/${code}`, options.baseUrl).href : null),
		calendarName: APP_NAME,
		busyLabel: options.busyLabel ?? 'Busy'
	});
}

/** Composition root for routes. */
export function getCalendarPublishService(
	platform: App.Platform | undefined | null,
	options: { baseUrl?: string; busyLabel?: string } = {}
): CalendarPublishService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return calendarPublishServiceForDb(db, options);
}
