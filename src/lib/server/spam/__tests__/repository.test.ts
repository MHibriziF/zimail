import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1SpamRepository } from '../repository';

type Query = { sql: string; args: unknown[] };

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { repo: createD1SpamRepository(db), queries };
}

describe('SpamRepository', () => {
	test('a sender is blocked only when a row exists for that user', async () => {
		assert.equal(await setup(() => [{ blocked: 1 }]).repo.isBlocked('u1', 'bad@x.test'), true);
		const { repo, queries } = setup();
		assert.equal(await repo.isBlocked('u1', 'ok@x.test'), false);
		assert.deepEqual(queries[0].args, ['u1', 'ok@x.test']);
	});

	test('blocking inserts one row per address and ignores repeats', async () => {
		const { repo, queries } = setup();
		await repo.block('u1', []);
		assert.equal(queries.length, 0);

		await repo.block('u1', ['a@x.test', 'b@x.test']);
		assert.equal(queries.length, 2);
		assert.match(queries[0].sql, /INSERT OR IGNORE INTO blocked_senders/);
		assert.deepEqual(queries[1].args, ['u1', 'b@x.test']);
	});

	test('unblocking deletes the given addresses in one statement', async () => {
		const { repo, queries } = setup();
		await repo.unblock('u1', []);
		assert.equal(queries.length, 0);

		await repo.unblock('u1', ['a@x.test', 'b@x.test']);
		assert.match(queries[0].sql, /address IN \(\?, \?\)/);
		assert.deepEqual(queries[0].args, ['u1', 'a@x.test', 'b@x.test']);
	});

	test('inbound senders come from the given messages, blanks dropped', async () => {
		const { repo, queries } = setup(() => [{ address: 'a@x.test' }, { address: '' }]);
		assert.deepEqual(await repo.inboundSenders('u1', []), []);
		assert.equal(queries.length, 0);

		assert.deepEqual(await repo.inboundSenders('u1', ['e1']), ['a@x.test']);
		assert.match(queries[0].sql, /direction = 'inbound'/);
	});
});
