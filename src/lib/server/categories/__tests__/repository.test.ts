import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1CategoriesRepository } from '../repository';

type Query = { sql: string; args: unknown[] };

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { repo: createD1CategoriesRepository(db), queries };
}

describe('CategoriesRepository', () => {
	test('a remembered sender comes back as its tab; anything unknown as null', async () => {
		const { repo } = setup((query) =>
			query.args[1] === 'news@shop.test' ? [{ category: 'promotions' }] : [{ category: 'bogus' }]
		);
		assert.equal(await repo.senderCategory('u1', 'news@shop.test'), 'promotions');
		assert.equal(await repo.senderCategory('u1', 'other@shop.test'), null);
	});

	test('remembering senders upserts one row each, and nothing for none', async () => {
		const { repo, queries } = setup();
		await repo.rememberSender('u1', [], 'updates');
		assert.equal(queries.length, 0);

		await repo.rememberSender('u1', ['a@x.test', 'b@x.test'], 'updates');
		assert.equal(queries.length, 2);
		assert.match(queries[0].sql, /ON CONFLICT \(user_id, address\) DO UPDATE/);
		assert.deepEqual(queries[1].args, ['u1', 'b@x.test', 'updates']);
	});

	test('inbound senders are read for the given messages only, blanks dropped', async () => {
		const { repo, queries } = setup(() => [{ address: 'a@x.test' }, { address: '' }]);
		assert.deepEqual(await repo.inboundSenders('u1', []), []);
		assert.equal(queries.length, 0);

		assert.deepEqual(await repo.inboundSenders('u1', ['e1', 'e2']), ['a@x.test']);
		assert.match(queries[0].sql, /direction = 'inbound' AND id IN \(\?, \?\)/);
		assert.deepEqual(queries[0].args, ['u1', 'e1', 'e2']);
	});

	test('tabs are on unless switched off', async () => {
		assert.equal(await setup(() => []).repo.tabsEnabled('u1'), true);
		assert.equal(await setup(() => [{ inbox_tabs: 1 }]).repo.tabsEnabled('u1'), true);
		assert.equal(await setup(() => [{ inbox_tabs: 0 }]).repo.tabsEnabled('u1'), false);
	});

	test('switching tabs stores 1 or 0', async () => {
		const { repo, queries } = setup();
		await repo.setTabsEnabled('u1', false);
		await repo.setTabsEnabled('u1', true);
		assert.deepEqual(
			queries.map((query) => query.args),
			[
				[0, 'u1'],
				[1, 'u1']
			]
		);
	});

	test('unsorted messages come back with the tab their conversation already has', async () => {
		const { repo, queries } = setup(() => [
			{ id: 'e1', from_addr: 'a@x.test', subject: 'Hi', conversation_id: 't1', existing_category: 'social' },
			{ id: 'e2', from_addr: 'b@x.test', subject: 'Yo', conversation_id: 'e2', existing_category: null }
		]);
		const messages = await repo.uncategorized('u1', 50);
		assert.deepEqual(messages, [
			{ id: 'e1', from: 'a@x.test', subject: 'Hi', conversationId: 't1', existingCategory: 'social' },
			{ id: 'e2', from: 'b@x.test', subject: 'Yo', conversationId: 'e2', existingCategory: null }
		]);
		assert.deepEqual(queries[0].args, ['u1', 50]);
	});

	test('the unsorted count is by conversation, and zero when nothing is found', async () => {
		assert.equal(await setup(() => [{ count: 7 }]).repo.countUncategorized('u1'), 7);
		assert.equal(await setup(() => []).repo.countUncategorized('u1'), 0);
	});
});
