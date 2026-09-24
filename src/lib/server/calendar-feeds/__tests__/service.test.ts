import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { FeedEvent } from '../../../calendar/ics';
import { MAX_FEEDS_PER_USER } from '../../../calendar/feeds';
import type { CalendarFeedsRepository, StoredFeed, SyncRecord } from '../repository';
import { createCalendarFeedsService } from '../service';
import { FeedFetchError } from '../fetch';

const ICS = [
	'BEGIN:VCALENDAR',
	'BEGIN:VEVENT',
	'UID:one',
	'SUMMARY:Dentist',
	'DTSTART:20260925T020000Z',
	'DTEND:20260925T030000Z',
	'END:VEVENT',
	'END:VCALENDAR'
].join('\r\n');

function fakeRepo() {
	const feeds: StoredFeed[] = [];
	const events = new Map<string, FeedEvent[]>();
	const records: { id: string; record: SyncRecord }[] = [];
	const repo: CalendarFeedsRepository = {
		async listForUser(userId) {
			return feeds.filter((feed) => feed.userId === userId);
		},
		async countForUser(userId) {
			return feeds.filter((feed) => feed.userId === userId).length;
		},
		async get(userId, id) {
			return feeds.find((feed) => feed.userId === userId && feed.id === id) ?? null;
		},
		async insert(feed) {
			feeds.push({ ...feed, eventCount: 0, lastSyncedAt: null, lastError: null });
		},
		async update(userId, id, patch) {
			const feed = feeds.find((entry) => entry.userId === userId && entry.id === id);
			if (!feed) return false;
			Object.assign(feed, patch);
			return true;
		},
		async delete(userId, id) {
			const index = feeds.findIndex((entry) => entry.userId === userId && entry.id === id);
			if (index < 0) return false;
			feeds.splice(index, 1);
			events.delete(id);
			return true;
		},
		async listDue(_before, limit) {
			return feeds.slice(0, limit);
		},
		async recordSync(id, record) {
			records.push({ id, record });
			const feed = feeds.find((entry) => entry.id === id)!;
			feed.lastError = record.error;
			if (record.syncedAt) feed.lastSyncedAt = record.syncedAt;
			if (record.eventCount !== null) feed.eventCount = record.eventCount;
		},
		async replaceEvents(_userId, feedId, list) {
			events.set(feedId, list);
		}
	};
	return { repo, feeds, events, records };
}

function setup(fetchFeed: (url: string) => Promise<string> = async () => ICS) {
	const state = fakeRepo();
	const fetched: string[] = [];
	const service = createCalendarFeedsService({
		repo: state.repo,
		fetchFeed: async (url) => {
			fetched.push(url);
			return fetchFeed(url);
		},
		timeZoneOf: async () => 'UTC',
		now: () => new Date('2026-09-24T00:00:00.000Z')
	});
	return { service, fetched, ...state };
}

const input = { name: ' Work  calendar ', url: 'webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics', color: 'green' as const };

describe('CalendarFeedsService', () => {
	test('adding normalises, syncs once, and never exposes the URL', async () => {
		const { service, fetched, events } = setup();
		const outcome = await service.add('u1', input);
		assert.equal(outcome.type, 'ok');
		if (outcome.type !== 'ok') return;
		assert.equal(outcome.feed.name, 'Work calendar');
		assert.equal(outcome.feed.host, 'calendar.google.com');
		assert.equal(outcome.feed.eventCount, 1);
		assert.equal(outcome.feed.lastError, null);
		assert.ok(!JSON.stringify(outcome.feed).includes('private-abc'));
		assert.deepEqual(fetched, ['https://calendar.google.com/calendar/ical/x/private-abc/basic.ics']);
		assert.equal(events.get(outcome.feed.id)?.[0].title, 'Dentist');
	});

	test('rejects a blank name, a non-https address and too many feeds', async () => {
		const { service, feeds } = setup();
		assert.deepEqual(await service.add('u1', { ...input, name: ' ' }), { type: 'invalid_name' });
		assert.deepEqual(await service.add('u1', { ...input, url: 'http://example.com/cal.ics' }), { type: 'invalid_url' });
		assert.deepEqual(await service.add('u1', { ...input, url: 'not a url' }), { type: 'invalid_url' });
		for (let index = 0; index < MAX_FEEDS_PER_USER; index++) {
			feeds.push({ id: `f${index}`, userId: 'u1', name: 'x', url: 'https://x', color: 'blue', eventCount: 0, lastSyncedAt: null, lastError: null });
		}
		assert.deepEqual(await service.add('u1', input), { type: 'limit_reached' });
	});

	test('a failed first sync keeps the feed with a readable error and no events', async () => {
		const { service, events } = setup(async () => {
			throw new FeedFetchError('The calendar address was refused — it may have been reset.');
		});
		const outcome = await service.add('u1', input);
		assert.equal(outcome.type, 'ok');
		if (outcome.type !== 'ok') return;
		assert.match(outcome.feed.lastError ?? '', /refused/);
		assert.equal(outcome.feed.lastSyncedAt, null);
		assert.equal(events.has(outcome.feed.id), false);
	});

	test('an unexpected failure is reported generically', async () => {
		const { service } = setup(async () => {
			throw new Error('socket hang up at 10.0.0.3');
		});
		const outcome = await service.add('u1', input);
		assert.equal(outcome.type === 'ok' && outcome.feed.lastError, 'The calendar could not be read.');
	});

	test('a failed re-sync keeps the last good events and sync time', async () => {
		let fail = false;
		const { service, events } = setup(async () => {
			if (fail) throw new FeedFetchError('down');
			return ICS;
		});
		const added = await service.add('u1', input);
		assert.equal(added.type, 'ok');
		if (added.type !== 'ok') return;
		fail = true;
		const again = await service.sync('u1', added.feed.id);
		assert.equal(again.type === 'ok' && again.feed.lastSyncedAt, added.feed.lastSyncedAt);
		assert.equal(events.get(added.feed.id)?.length, 1);
	});

	test('another user can’t sync, rename or remove a feed', async () => {
		const { service } = setup();
		const added = await service.add('u1', input);
		assert.equal(added.type, 'ok');
		if (added.type !== 'ok') return;
		assert.deepEqual(await service.sync('u2', added.feed.id), { type: 'not_found' });
		assert.deepEqual(await service.update('u2', added.feed.id, { name: 'Mine' }), { type: 'not_found' });
		assert.equal(await service.remove('u2', added.feed.id), false);
	});

	test('syncDue counts successes and failures', async () => {
		const { service, feeds } = setup(async (url) => {
			if (url.includes('bad')) throw new FeedFetchError('nope');
			return ICS;
		});
		feeds.push(
			{ id: 'a', userId: 'u1', name: 'A', url: 'https://good.example/a.ics', color: 'blue', eventCount: 0, lastSyncedAt: null, lastError: null },
			{ id: 'b', userId: 'u1', name: 'B', url: 'https://bad.example/b.ics', color: 'blue', eventCount: 0, lastSyncedAt: null, lastError: null }
		);
		assert.deepEqual(await service.syncDue(5), { synced: 1, failed: 1 });
	});
});
