import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MailCategory } from '../../../mail/categories';
import type { CategoriesRepository, UncategorizedMessage } from '../repository';
import { createCategoriesService } from '../service';

function setup(options: { uncategorized?: UncategorizedMessage[]; senders?: string[] } = {}) {
	const remembered = new Map<string, MailCategory>();
	const categoryOf = new Map<string, MailCategory>();
	let tabs = true;
	let pending = [...(options.uncategorized ?? [])];

	const repo: CategoriesRepository = {
		async senderCategory(_userId, address) {
			return remembered.get(address) ?? null;
		},
		async rememberSender(_userId, addresses, category) {
			for (const address of addresses) remembered.set(address, category);
		},
		async inboundSenders() {
			return options.senders ?? ['news@shop.test'];
		},
		tabsEnabled: async () => tabs,
		async setTabsEnabled(_userId, enabled) {
			tabs = enabled;
		},
		async uncategorized(_userId, limit) {
			return pending.slice(0, limit);
		},
		countUncategorized: async () => pending.length
	};

	const service = createCategoriesService({
		repo,
		expandToThreads: async (userId, ids) => (userId === 'user-1' ? ids.flatMap((id) => [id, `${id}-reply`]) : []),
		async setCategory(_userId, ids, category) {
			for (const id of ids) categoryOf.set(id, category);
			pending = pending.filter((message) => !ids.includes(message.id));
			return ids.length;
		},
		ownAddresses: async () => ['me@example.com']
	});
	return { service, remembered, categoryOf };
}

describe('categorizeInbound', () => {
	test('uses the rules for a sender the user never sorted', async () => {
		const { service } = setup();
		const category = await service.categorizeInbound('user-1', {
			from: 'news@shop.test',
			subject: 'Sale',
			headers: { 'list-unsubscribe': '<https://shop.test/u>' }
		});
		assert.equal(category, 'promotions');
	});

	test('a sender the user moved before wins over the rules', async () => {
		const { service } = setup();
		await service.moveToCategory('user-1', ['m1'], 'primary');
		const category = await service.categorizeInbound('user-1', {
			from: 'News@Shop.test',
			subject: 'Sale',
			headers: { 'list-unsubscribe': '<https://shop.test/u>' }
		});
		assert.equal(category, 'primary');
	});
});

describe('moveToCategory', () => {
	test('moves the whole conversation and remembers the sender', async () => {
		const { service, remembered, categoryOf } = setup();
		assert.equal(await service.moveToCategory('user-1', ['m1'], 'updates'), 2);
		assert.equal(categoryOf.get('m1-reply'), 'updates');
		assert.equal(remembered.get('news@shop.test'), 'updates');
	});

	test("the user's own address is never remembered", async () => {
		const { service, remembered } = setup({ senders: ['me@example.com'] });
		await service.moveToCategory('user-1', ['m1'], 'updates');
		assert.equal(remembered.size, 0);
	});

	test("someone else's mail can't be moved", async () => {
		const { service, categoryOf } = setup();
		assert.equal(await service.moveToCategory('user-2', ['m1'], 'updates'), 0);
		assert.equal(categoryOf.size, 0);
	});
});

describe('backfill', () => {
	test('sorts old conversations by sender and subject, and reports what is left', async () => {
		const { service, categoryOf } = setup({
			uncategorized: [
				{ id: 'a', from: 'notification@facebookmail.com', subject: 'New comment', conversationId: 'a', existingCategory: null },
				{ id: 'b', from: 'ada@example.com', subject: 'Lunch?', conversationId: 'b', existingCategory: null },
				{ id: 'c', from: 'no-reply@bank.test', subject: 'Statement', conversationId: 'c', existingCategory: null }
			]
		});
		assert.deepEqual(await service.backfill('user-1', 2), { sorted: 2, remaining: 1 });
		assert.deepEqual(await service.backfill('user-1', 2), { sorted: 1, remaining: 0 });
		assert.equal(categoryOf.get('a'), 'social');
		assert.equal(categoryOf.get('b'), 'primary');
		assert.equal(categoryOf.get('c-reply'), 'updates');
	});
});

describe('backfill keeps a conversation in one tab', () => {
	test("a conversation that already has a tab keeps it instead of being re-sorted", async () => {
		const { service, categoryOf } = setup({
			uncategorized: [{ id: 'late', from: 'ada@example.com', subject: 'Re: hi', conversationId: 'c1', existingCategory: 'updates' }]
		});
		await service.backfill('user-1');
		assert.equal(categoryOf.get('late'), 'updates');
	});
});

describe('tabs setting', () => {
	test('can be switched off and on', async () => {
		const { service } = setup();
		await service.setTabsEnabled('user-1', false);
		assert.equal(await service.tabsEnabled('user-1'), false);
	});
});
