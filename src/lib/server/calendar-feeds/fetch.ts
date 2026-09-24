/**
 * Downloads a published calendar. Bounded in time and size: a feed is someone
 * else's server, and a sync runs inside a cron tick.
 */

export const FEED_TIMEOUT_MS = 15_000;
/** Google's feed for a busy multi-year calendar is a few MB; beyond this, refuse. */
export const MAX_FEED_BYTES = 8 * 1024 * 1024;

export class FeedFetchError extends Error {}

async function readCapped(response: Response): Promise<string> {
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > MAX_FEED_BYTES) throw new FeedFetchError('The calendar is too large to import.');
	if (!response.body) return '';

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_FEED_BYTES) {
			await reader.cancel();
			throw new FeedFetchError('The calendar is too large to import.');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

export async function fetchFeedText(url: string, fetcher: typeof fetch = fetch): Promise<string> {
	let response: Response;
	try {
		response = await fetcher(url, {
			headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1' },
			redirect: 'follow',
			signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
		});
	} catch {
		throw new FeedFetchError('Could not reach the calendar address.');
	}
	if (response.status === 401 || response.status === 403 || response.status === 404) {
		throw new FeedFetchError('The calendar address was refused — it may have been reset.');
	}
	if (!response.ok) throw new FeedFetchError(`The calendar server answered ${response.status}.`);

	const text = await readCapped(response);
	if (!text.includes('BEGIN:VCALENDAR')) throw new FeedFetchError('That address is not an iCal calendar.');
	return text;
}
