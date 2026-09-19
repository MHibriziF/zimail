import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1LabelsRepository } from '../repository';

type Query = { sql: string; args: unknown[] };

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { repo: createD1LabelsRepository(db), queries };
}

describe('LabelsRepository', () => {
	test('every query is scoped to the user', async () => {
		const { repo, queries } = setup();
		await repo.listForUser('user-1');
		await repo.update('user-1', 'label-1', { name: 'Work' });
		await repo.delete('user-1', 'label-1');
		await repo.ownedIds('user-1', ['a', 'b']);
		await repo.listForConversations('user-1', ['c1']);
		for (const query of queries) {
			assert.match(query.sql, /user_id = \?/);
			assert.ok(query.args.includes('user-1'));
		}
	});

	test('an unknown stored color reads as gray', async () => {
		const { repo } = setup(() => [{ id: 'l1', name: 'Work', color: 'chartreuse' }]);
		assert.deepEqual(await repo.listForUser('user-1'), [{ id: 'l1', name: 'Work', color: 'gray' }]);
	});

	test('an empty update touches nothing', async () => {
		const { repo, queries } = setup();
		assert.equal(await repo.update('user-1', 'label-1', {}), false);
		assert.equal(queries.length, 0);
	});

	test('setting a conversation clears then inserts, in one batch', async () => {
		const { repo, queries } = setup();
		await repo.setForConversation('user-1', 'c1', ['a', 'b']);
		assert.deepEqual(
			queries.map((query) => query.sql.split(' ').slice(0, 3).join(' ')),
			['DELETE FROM conversation_labels', 'INSERT INTO conversation_labels', 'INSERT INTO conversation_labels']
		);
	});

	test('conversation labels are grouped by conversation', async () => {
		const { repo } = setup(() => [
			{ conversation_id: 'c1', id: 'a', name: 'Home', color: 'green' },
			{ conversation_id: 'c1', id: 'b', name: 'Work', color: 'blue' },
			{ conversation_id: 'c2', id: 'b', name: 'Work', color: 'blue' }
		]);
		const grouped = await repo.listForConversations('user-1', ['c1', 'c2']);
		assert.deepEqual(grouped.get('c1')?.map((l) => l.id), ['a', 'b']);
		assert.deepEqual(grouped.get('c2')?.map((l) => l.id), ['b']);
	});

	test('no conversations means no query', async () => {
		const { repo, queries } = setup();
		assert.equal((await repo.listForConversations('user-1', [])).size, 0);
		assert.deepEqual(await repo.ownedIds('user-1', []), []);
		assert.equal(queries.length, 0);
	});
});
