import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fetchFeedText, FeedFetchError, MAX_FEED_BYTES } from '../fetch';
import { normalizeFeedUrl } from '../../../calendar/feeds';

const calendar = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
const respond = (response: Response) => (async () => response) as unknown as typeof fetch;

describe('fetchFeedText', () => {
	test('returns the calendar text', async () => {
		assert.equal(await fetchFeedText('https://x', respond(new Response(calendar))), calendar);
	});

	test('explains a refused address and other failures', async () => {
		await assert.rejects(fetchFeedText('https://x', respond(new Response('', { status: 404 }))), /refused/);
		await assert.rejects(fetchFeedText('https://x', respond(new Response('', { status: 500 }))), /500/);
		await assert.rejects(
			fetchFeedText('https://x', (async () => {
				throw new TypeError('network');
			}) as unknown as typeof fetch),
			FeedFetchError
		);
	});

	test('refuses something that is not a calendar', async () => {
		await assert.rejects(fetchFeedText('https://x', respond(new Response('<html>'))), /not an iCal/);
	});

	test('refuses an oversized feed, declared or streamed', async () => {
		const declared = new Response(calendar, { headers: { 'content-length': String(MAX_FEED_BYTES + 1) } });
		await assert.rejects(fetchFeedText('https://x', respond(declared)), /too large/);
		const streamed = new Response(new Uint8Array(MAX_FEED_BYTES + 10));
		await assert.rejects(fetchFeedText('https://x', respond(streamed)), /too large/);
	});
});

describe('normalizeFeedUrl', () => {
	test('webcal becomes https; http, credentials and junk are refused', () => {
		assert.equal(normalizeFeedUrl(' webcal://p01-caldav.icloud.com/published/2/abc '), 'https://p01-caldav.icloud.com/published/2/abc');
		assert.equal(normalizeFeedUrl('WEBCALS://example.com/a.ics'), 'https://example.com/a.ics');
		assert.equal(normalizeFeedUrl('http://example.com/a.ics'), null);
		assert.equal(normalizeFeedUrl('https://user:pw@example.com/a.ics'), null);
		assert.equal(normalizeFeedUrl('file:///etc/passwd'), null);
		assert.equal(normalizeFeedUrl(''), null);
	});
});
