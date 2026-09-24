import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1InvitationsRepository, type InviteEventRow } from '../repository';

type Query = { sql: string; args: unknown[] };

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { repo: createD1InvitationsRepository(db), queries };
}

const row: InviteEventRow = {
	id: 'ev-1',
	externalUid: 'meet-1#1',
	title: 'Demo',
	start: '2026-09-25T03:30:00.000Z',
	end: '2026-09-25T04:00:00.000Z',
	allDay: false,
	location: null,
	notes: null,
	busy: true
};

describe('InvitationsRepository', () => {
	test('a stored invite reads back with its answer; an unknown answer reads as none', async () => {
		const { repo } = setup(() => [{ uid: 'meet-1', sequence: 2, response: 'accepted' }]);
		assert.deepEqual(await repo.get('u1', 'meet-1'), { uid: 'meet-1', sequence: 2, response: 'accepted' });
		const odd = setup(() => [{ uid: 'meet-1', sequence: 0, response: 'bogus' }]);
		assert.equal((await odd.repo.get('u1', 'meet-1'))?.response, null);
		assert.equal(await setup().repo.get('u1', 'nope'), null);
	});

	test('saving upserts by user and UID', async () => {
		const { repo, queries } = setup();
		await repo.save('u1', { uid: 'meet-1', sequence: 3, response: null });
		assert.match(queries[0].sql, /ON CONFLICT \(user_id, uid\) DO UPDATE/);
		assert.deepEqual(queries[0].args, ['u1', 'meet-1', 3, null]);
	});

	test('whether any occurrence is on the calendar', async () => {
		assert.equal(await setup(() => [{ found: 1 }]).repo.hasEvents('u1', 'meet-1'), true);
		const { repo, queries } = setup();
		assert.equal(await repo.hasEvents('u1', 'meet-1'), false);
		assert.match(queries[0].sql, /source = 'invite' AND source_id = \?/);
	});

	test('replacing a series deletes its rows and inserts the new ones in one batch', async () => {
		const { repo, queries } = setup();
		await repo.replaceEvents('u1', 'meet-1', [row, { ...row, id: 'ev-2', allDay: true, busy: false }]);
		assert.equal(queries.length, 3);
		assert.match(queries[0].sql, /DELETE FROM calendar_events/);
		assert.match(queries[1].sql, /VALUES \(\?, \?, 'invite'/);
		assert.deepEqual(queries[2].args.slice(-4), [1, null, null, 0]);
	});

	test('one occurrence can be swapped, or just dropped', async () => {
		const { repo, queries } = setup();
		await repo.replaceOccurrence('u1', 'meet-1', 'meet-1#1', row);
		await repo.replaceOccurrence('u1', 'meet-1', 'meet-1#2', null);
		assert.equal(queries.length, 3);
		assert.deepEqual(queries[0].args, ['u1', 'meet-1', 'meet-1#1']);
		assert.match(queries[2].sql, /external_uid = \?/);
	});

	test('removing takes every occurrence of the UID, scoped to the user', async () => {
		const { repo, queries } = setup();
		await repo.removeEvents('u1', 'meet-1');
		assert.deepEqual(queries[0].args, ['u1', 'meet-1']);
		assert.match(queries[0].sql, /user_id = \? AND source = 'invite'/);
	});
});
