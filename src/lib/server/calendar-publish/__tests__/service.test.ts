import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarEvent } from '../../../calendar/events';
import type { CalendarPublishRepository, PublishedFeedRow } from '../repository';
import { CACHE_MAX_AGE_MS, createCalendarPublishService, isFresh } from '../service';

const event: CalendarEvent = {
	id: 'ev1',
	title: 'Standup',
	start: '2026-10-06T09:00:00.000Z',
	end: '2026-10-06T09:15:00.000Z',
	allDay: false,
	location: null,
	notes: null,
	source: 'manual',
	busy: true,
	calendar: null,
	meetingCode: 'abc-defg-hij'
};

function setup(now = new Date('2026-10-05T12:00:00Z')) {
	const rows = new Map<string, PublishedFeedRow & { tokenHash: string }>();
	let listCalls = 0;
	let listed: { from: string; to: string; includeFeeds: boolean } | null = null;
	/** Simulates an event write landing while a rebuild is in flight. */
	let writeDuringBuild = false;

	const repo: CalendarPublishRepository = {
		async options(userId) {
			const row = rows.get(userId);
			return row ? { includeFeeds: row.includeFeeds, busyOnly: row.busyOnly } : null;
		},
		async findByTokenHash(tokenHash) {
			const row = [...rows.values()].find((entry) => entry.tokenHash === tokenHash);
			return row ? { ...row } : null;
		},
		async setToken(userId, tokenHash) {
			const row = rows.get(userId);
			rows.set(userId, { userId, tokenHash, includeFeeds: row?.includeFeeds ?? false, busyOnly: row?.busyOnly ?? false, ics: null, builtAt: null });
		},
		async setOptions(userId, options) {
			const row = rows.get(userId);
			if (!row) return false;
			rows.set(userId, { ...row, ...options, ics: null, builtAt: null });
			return true;
		},
		async remove(userId) {
			rows.delete(userId);
		},
		async markBuilding(userId) {
			const row = rows.get(userId);
			if (row) rows.set(userId, { ...row, ics: '', builtAt: null });
		},
		async saveBuilt(userId, ics, builtAt) {
			const row = rows.get(userId);
			if (row?.ics === '') rows.set(userId, { ...row, ics, builtAt });
		}
	};

	let tokens = 0;
	const service = createCalendarPublishService({
		repo,
		async listEvents(userId, from, to, options) {
			listCalls += 1;
			listed = { from, to, includeFeeds: options.includeFeeds };
			if (writeDuringBuild) {
				// What the eviction trigger does to the row.
				const row = rows.get(userId);
				if (row) rows.set(userId, { ...row, ics: null, builtAt: null });
			}
			return [event];
		},
		hashToken: async (token) => `hash:${token}`,
		createToken: () => `token${++tokens}`,
		meetingUrl: (code) => `https://mail.example/meet/${code}`,
		calendarName: 'Zimail',
		busyLabel: 'Busy',
		now: () => now
	});

	return {
		service,
		rows,
		listCalls: () => listCalls,
		listed: () => listed,
		evict: (userId: string) => {
			const row = rows.get(userId);
			if (row) rows.set(userId, { ...row, ics: null, builtAt: null });
		},
		writeDuringBuild: () => (writeDuringBuild = true)
	};
}

describe('publishing a calendar', () => {
	test('publishing returns a token and stores only its hash', async () => {
		const { service, rows } = setup();
		const { token } = await service.publish('u1');
		assert.equal(rows.get('u1')?.tokenHash, `hash:${token}`);
		assert.deepEqual(await service.status('u1'), { published: true, includeFeeds: false, busyOnly: false });
	});

	test('resetting the link kills the old one', async () => {
		const { service } = setup();
		const first = await service.publish('u1');
		const second = await service.publish('u1');
		assert.equal(await service.feed(first.token), null);
		assert.match((await service.feed(second.token)) ?? '', /SUMMARY:Standup/);
	});

	test('an unknown token gets nothing', async () => {
		const { service } = setup();
		assert.equal(await service.feed('nope'), null);
	});

	test('options need a published calendar', async () => {
		const { service } = setup();
		assert.equal(await service.setOptions('u1', { includeFeeds: true, busyOnly: false }), 'not_published');
	});

	test('unpublishing removes the feed', async () => {
		const { service } = setup();
		const { token } = await service.publish('u1');
		await service.unpublish('u1');
		assert.equal(await service.feed(token), null);
		assert.deepEqual(await service.status('u1'), { published: false });
	});
});

describe('serving the feed from its cache', () => {
	test('a second fetch with nothing changed reads no events', async () => {
		const { service, listCalls } = setup();
		const { token } = await service.publish('u1');
		const first = await service.feed(token);
		const second = await service.feed(token);
		assert.equal(first, second);
		assert.equal(listCalls(), 1);
	});

	test('after a change evicts it, the next fetch rebuilds once', async () => {
		const { service, listCalls, evict } = setup();
		const { token } = await service.publish('u1');
		await service.feed(token);
		evict('u1');
		await service.feed(token);
		await service.feed(token);
		assert.equal(listCalls(), 2);
	});

	test('a file built while an event was written is served but not cached', async () => {
		const { service, rows, listCalls, writeDuringBuild } = setup();
		const { token } = await service.publish('u1');
		writeDuringBuild();
		assert.match((await service.feed(token)) ?? '', /BEGIN:VCALENDAR/);
		assert.equal(rows.get('u1')?.ics, null);
		await service.feed(token);
		assert.equal(listCalls(), 2);
	});

	test('changing an option drops the cache', async () => {
		const { service, listCalls, listed } = setup();
		const { token } = await service.publish('u1');
		await service.feed(token);
		await service.setOptions('u1', { includeFeeds: true, busyOnly: true });
		assert.match((await service.feed(token)) ?? '', /SUMMARY:Busy/);
		assert.equal(listCalls(), 2);
		assert.equal(listed()?.includeFeeds, true);
	});

	test('the window runs from 90 days back to a year ahead, and links meeting rooms', async () => {
		const { service, listed } = setup(new Date('2026-10-05T12:00:00Z'));
		const { token } = await service.publish('u1');
		const ics = await service.feed(token);
		assert.equal(listed()?.from, '2026-07-07T12:00:00.000Z');
		assert.equal(listed()?.to, '2027-10-05T12:00:00.000Z');
		assert.match(ics ?? '', /URL:https:\/\/mail.example\/meet\/abc-defg-hij/);
	});

	test('a cached file goes stale after a week so its window moves', () => {
		const now = new Date('2026-10-05T12:00:00Z');
		const recent = new Date(now.getTime() - CACHE_MAX_AGE_MS + 60_000).toISOString();
		const old = new Date(now.getTime() - CACHE_MAX_AGE_MS - 60_000).toISOString();
		assert.equal(isFresh('ics', recent, now), true);
		assert.equal(isFresh('ics', old, now), false);
		assert.equal(isFresh('', recent, now), false);
		assert.equal(isFresh(null, null, now), false);
	});
});
