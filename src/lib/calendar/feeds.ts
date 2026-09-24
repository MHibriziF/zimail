/**
 * Calendar feed rules shared by the server (which enforces them) and the
 * subscription form (which checks the same things first).
 */
import type { LabelColor } from '../mail/labels';

export const MAX_FEED_NAME_LENGTH = 60;
export const MAX_FEED_URL_LENGTH = 2000;
export const MAX_FEEDS_PER_USER = 20;

/** What the client sees of a feed — never the URL itself, which is a secret. */
export type CalendarFeed = {
	id: string;
	name: string;
	color: LabelColor;
	host: string;
	eventCount: number;
	lastSyncedAt: string | null;
	lastError: string | null;
};

/**
 * `webcal://` is how calendar apps advertise a subscription; it's HTTPS
 * underneath. Plain `http://` is refused: the URL is a credential.
 */
export function normalizeFeedUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed || trimmed.length > MAX_FEED_URL_LENGTH) return null;
	const withScheme = /^webcals?:\/\//i.test(trimmed) ? trimmed.replace(/^webcals?:/i, 'https:') : trimmed;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export function normalizeFeedName(input: string): string | null {
	const name = input.trim().replaceAll(/\s+/g, ' ').slice(0, MAX_FEED_NAME_LENGTH).trim();
	return name || null;
}
