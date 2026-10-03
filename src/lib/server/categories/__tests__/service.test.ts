import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MailCategory } from '../../../mail/categories';
import type { TabMessage, TabsOutcome } from '../../ai/tabs';
import type { CategoriesRepository, ResortCandidate, UncategorizedMessage } from '../repository';
import { createCategoriesService } from '../service';

type SetupOptions = {
	uncategorized?: UncategorizedMessage[];
	senders?: string[];
	/** Scripted Clef: answers each message, or `null` for a deploy without the AI binding. */
	clef?: ((messages: TabMessage[]) => TabsOutcome) | null;
	ai?: boolean;
	candidates?: ResortCandidate[];
};

function setup(options: SetupOptions = {}) {
	const remembered = new Map<string, MailCategory>();
	const categoryOf = new Map<string, MailCategory>();
	const asked: TabMessage[][] = [];
	let tabs = true;
	let ai = options.ai ?? false;
	let pending = [...(options.uncategorized ?? [])];
	const clef = options.clef === undefined ? () => ({ kind: 'sorted' as const, tabs: [] }) : options.clef;

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
		countUncategorized: async () => pending.length,
		tabSettings: async () => ({ enabled: tabs, ai }),
		async setAiTabsEnabled(_userId, enabled) {
			ai = enabled;
		},
		resortCandidates: async (_userId, limit) => (options.candidates ?? []).slice(0, limit)
	};

	const service = createCategoriesService({
		repo,
		expandToThreads: async (userId, ids) => (userId === 'user-1' ? ids.flatMap((id) => [id, `${id}-reply`]) : []),
		async setCategory(_userId, ids, category) {
			for (const id of ids) categoryOf.set(id, category);
			pending = pending.filter((message) => !ids.includes(message.id));
			return ids.length;
		},
		ownAddresses: async () => ['me@example.com'],
		sortTabs: clef
			? async (messages) => {
					asked.push(messages);
					return clef(messages);
				}
			: null
	});
	return { service, remembered, categoryOf, asked };
}

/** A Clef that puts everything in one tab. */
const always =
	(tab: MailCategory) =>
	(messages: TabMessage[]): TabsOutcome => ({ kind: 'sorted', tabs: messages.map(() => tab) });

const signInLink = {
	from: 'hello@notion.so',
	subject: "Here's your link",
	body: 'Click to log in.',
	headers: { 'list-unsubscribe': '<https://notion.so/u>' }
};

function candidate(id: string, category: MailCategory | null): ResortCandidate {
	return { id, from: `${id}@shop.test`, fromName: null, subject: id, bodyText: null, bodyHtml: '<p>Hi</p>', category };
}

describe('categorizeInbound with Clef', () => {
	test('stays on the rules, and never asks Clef, until the user turns it on', async () => {
		const { service, asked } = setup({ clef: always('primary') });
		assert.equal(await service.categorizeInbound('user-1', signInLink), 'promotions');
		assert.equal(asked.length, 0);
	});

	test("Clef's tab wins over the rules once it is on, reading the body", async () => {
		const { service, asked } = setup({ clef: always('primary'), ai: true });
		assert.equal(await service.categorizeInbound('user-1', signInLink), 'primary');
		assert.equal(asked[0][0].body, 'Click to log in.');
	});

	test('replies, spam, invitations and remembered senders never reach Clef', async () => {
		const { service, asked } = setup({ clef: always('social'), ai: true });
		await service.moveToCategory('user-1', ['m1'], 'updates');
		assert.equal(await service.categorizeInbound('user-1', { ...signInLink, reply: true }), 'promotions');
		assert.equal(await service.categorizeInbound('user-1', { ...signInLink, spam: true }), 'promotions');
		assert.equal(await service.categorizeInbound('user-1', { ...signInLink, calendar: true }), 'primary');
		assert.equal(await service.categorizeInbound('user-1', { ...signInLink, from: 'news@shop.test' }), 'updates');
		assert.equal(asked.length, 0);
	});

	test('falls back to the rules when Clef fails, runs out, or has no answer', async () => {
		for (const outcome of [{ kind: 'failed' }, { kind: 'limit_reached' }, { kind: 'sorted', tabs: [null] }] as TabsOutcome[]) {
			const { service } = setup({ clef: () => outcome, ai: true });
			assert.equal(await service.categorizeInbound('user-1', signInLink), 'promotions');
		}
	});

	test('switching tabs off stops Clef too', async () => {
		const { service, asked } = setup({ clef: always('primary'), ai: true });
		await service.setTabsEnabled('user-1', false);
		await service.categorizeInbound('user-1', signInLink);
		assert.equal(asked.length, 0);
	});

	test('a deploy without the AI binding uses the rules', async () => {
		const { service } = setup({ clef: null, ai: true });
		assert.equal(await service.categorizeInbound('user-1', signInLink), 'promotions');
	});
});

describe('resortWithAi', () => {
	test('writes only the conversations whose tab changed', async () => {
		const { service, categoryOf, asked } = setup({
			clef: always('updates'),
			ai: true,
			candidates: [candidate('a', 'promotions'), candidate('b', 'updates'), candidate('c', null)]
		});
		assert.deepEqual(await service.resortWithAi('user-1'), { kind: 'sorted', sorted: 3, moved: 2 });
		assert.deepEqual([...categoryOf.keys()].sort(), ['a', 'a-reply', 'c', 'c-reply']);
		assert.equal(asked[0][0].body, 'Hi');
	});

	test('an unsorted conversation Clef calls Primary needs no write', async () => {
		const { service, categoryOf } = setup({ clef: always('primary'), ai: true, candidates: [candidate('a', null)] });
		assert.deepEqual(await service.resortWithAi('user-1'), { kind: 'sorted', sorted: 1, moved: 0 });
		assert.equal(categoryOf.size, 0);
	});

	test('reads at most the batch it was given', async () => {
		const { service, asked } = setup({
			clef: always('updates'),
			ai: true,
			candidates: ['a', 'b', 'c'].map((id) => candidate(id, null))
		});
		await service.resortWithAi('user-1', 2);
		assert.equal(asked[0].length, 2);
	});

	test('refuses while off or unavailable, and passes the daily limit through', async () => {
		assert.deepEqual(await setup({ clef: always('updates') }).service.resortWithAi('user-1'), { kind: 'disabled' });
		assert.deepEqual(await setup({ clef: null, ai: true }).service.resortWithAi('user-1'), { kind: 'unavailable' });
		const limited = setup({ clef: () => ({ kind: 'limit_reached' }), ai: true, candidates: [candidate('a', null)] });
		assert.deepEqual(await limited.service.resortWithAi('user-1'), { kind: 'limit_reached' });
	});
});

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

	test('never asks Clef, even when it is on', async () => {
		const { service, asked } = setup({
			clef: always('primary'),
			ai: true,
			uncategorized: [{ id: 'a', from: 'news@shop.test', subject: 'Sale', conversationId: 'a', existingCategory: null }]
		});
		await service.backfill('user-1');
		assert.equal(asked.length, 0);
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

	test('AI sorting starts off and can be switched on', async () => {
		const { service } = setup();
		assert.deepEqual(await service.tabSettings('user-1'), { enabled: true, ai: false });
		await service.setAiTabsEnabled('user-1', true);
		assert.deepEqual(await service.tabSettings('user-1'), { enabled: true, ai: true });
	});
});
