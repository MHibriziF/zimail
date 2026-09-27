import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1CalendarFeedsRepository, diffFeedEvents } from '../repository';

type Query = { sql: string; args: unknown[] };

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { repo: createD1CalendarFeedsRepository(db), queries };
}

const event = (index: number) => ({
	uid: `u${index}`,
	title: 'T',
	start: '2026-09-24T02:00:00.000Z',
	end: '2026-09-24T03:00:00.000Z',
	allDay: false,
	location: null,
	busy: true
});

describe('CalendarFeedsRepository', () => {
	test('user-facing queries are scoped to the user', async () => {
		const { repo, queries } = setup();
		await repo.listForUser('user-1');
		await repo.get('user-1', 'f');
		await repo.update('user-1', 'f', { name: 'x' });
		await repo.delete('user-1', 'f');
		await repo.syncEvents('user-1', 'f', [event(1)]);
		for (const query of queries) {
			// Reads and deletes filter on it; the JSON insert binds it as the owner.
			assert.ok(query.args.includes('user-1'), query.sql);
		}
	});

	test('deleting a feed takes its events with it', async () => {
		const { repo, queries } = setup();
		await repo.delete('user-1', 'f');
		assert.match(queries[0].sql, /DELETE FROM calendar_events .* source = 'feed' AND source_id = \?/);
		assert.match(queries[1].sql, /DELETE FROM calendar_feeds/);
	});

	test('a first sync inserts every event in JSON chunks', async () => {
		const { repo, queries } = setup();
		await repo.syncEvents('user-1', 'f', Array.from({ length: 450 }, (_, index) => event(index)));
		assert.equal(queries.length, 3);
		assert.match(queries[0].sql, /^SELECT/);
		const firstChunk = JSON.parse(String(queries[1].args[2])) as unknown[];
		const secondChunk = JSON.parse(String(queries[2].args[2])) as unknown[];
		assert.equal(firstChunk.length + secondChunk.length, 450);
		assert.match(queries[1].sql, /^INSERT INTO calendar_events[\s\S]*json_each\(\?\)/);
	});

	test('an unchanged feed writes nothing', async () => {
		const { repo, queries } = setup((query) => (query.sql.startsWith('SELECT') ? [stored(1), stored(2)] : []));
		await repo.syncEvents('user-1', 'f', [event(1), event(2)]);
		assert.equal(queries.length, 1);
	});

	test('an unknown stored color reads as blue', async () => {
		const { repo } = setup(() => [
			{ id: 'f', user_id: 'u', name: 'W', url: 'https://x', color: 'plaid', event_count: 3, last_synced_at: null, last_error: null }
		]);
		assert.equal((await repo.get('u', 'f'))?.color, 'blue');
	});
});

const stored = (index: number) => ({
	id: `row-${index}`,
	external_uid: `u${index}`,
	title: 'T',
	starts_at: '2026-09-24T02:00:00.000Z',
	ends_at: '2026-09-24T03:00:00.000Z',
	all_day: 0,
	location: null,
	busy: 1
});

describe('diffFeedEvents', () => {
	test('keeps matching rows, updates changed ones, and removes what the feed dropped', () => {
		const diff = diffFeedEvents(
			[stored(1), stored(2), stored(3)],
			[event(1), { ...event(2), title: 'Moved' }, event(4)],
			() => 'new-id'
		);
		assert.deepEqual(diff.update.map((row) => [row.id, row.title]), [['row-2', 'Moved']]);
		assert.deepEqual(diff.insert.map((row) => [row.id, row.uid]), [['new-id', 'u4']]);
		assert.deepEqual(diff.remove, ['row-3']);
	});

	test('duplicate uids collapse to one row', () => {
		const diff = diffFeedEvents([stored(1), { ...stored(1), id: 'row-dup' }], [event(1), event(1), event(2), event(2)]);
		assert.deepEqual(diff.remove, ['row-dup']);
		assert.equal(diff.update.length, 0);
		assert.equal(diff.insert.length, 1);
	});
});
