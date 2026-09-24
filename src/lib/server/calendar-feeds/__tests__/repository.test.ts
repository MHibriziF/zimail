import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1CalendarFeedsRepository } from '../repository';

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
		await repo.replaceEvents('user-1', 'f', [event(1)]);
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

	test('replacing events clears the feed first, then inserts in JSON chunks', async () => {
		const { repo, queries } = setup();
		await repo.replaceEvents('user-1', 'f', Array.from({ length: 450 }, (_, index) => event(index)));
		assert.equal(queries.length, 3);
		assert.match(queries[0].sql, /^DELETE FROM calendar_events/);
		const firstChunk = JSON.parse(String(queries[1].args[2])) as unknown[];
		const secondChunk = JSON.parse(String(queries[2].args[2])) as unknown[];
		assert.equal(firstChunk.length + secondChunk.length, 450);
		assert.match(queries[1].sql, /json_each\(\?\)/);
	});

	test('an unknown stored color reads as blue', async () => {
		const { repo } = setup(() => [
			{ id: 'f', user_id: 'u', name: 'W', url: 'https://x', color: 'plaid', event_count: 3, last_synced_at: null, last_error: null }
		]);
		assert.equal((await repo.get('u', 'f'))?.color, 'blue');
	});
});
