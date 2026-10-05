/** Where a published feed is served; public, since the token in it is the only credential. */
export const PUBLISHED_FEED_PREFIX = '/api/calendar/ics/';

export function publishedFeedUrl(baseUrl: string, token: string): string {
	return new URL(`${PUBLISHED_FEED_PREFIX}${token}.ics`, baseUrl).href;
}
