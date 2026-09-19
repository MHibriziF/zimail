import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { MailFlagUpdate } from '../../mail-store/repository';
import type { SpamRepository } from '../repository';
import { createSpamService } from '../service';

/** Conversation c1 = messages a, b (both from spammer@x.test); the user owns me@example.com. */
function setup(options: { senders?: string[] } = {}) {
	const blocked = new Set<string>();
	const flagCalls: { ids: string[]; update: MailFlagUpdate }[] = [];

	const repo: SpamRepository = {
		async isBlocked(_userId, address) {
			return blocked.has(address);
		},
		async block(_userId, addresses) {
			for (const address of addresses) blocked.add(address);
		},
		async unblock(_userId, addresses) {
			for (const address of addresses) blocked.delete(address);
		},
		async inboundSenders() {
			return options.senders ?? ['spammer@x.test'];
		}
	};

	const service = createSpamService({
		repo,
		expandToThreads: async (userId, ids) => (userId === 'user-1' && ids.includes('a') ? ['a', 'b'] : []),
		async setEmailFlags(_userId, ids, update) {
			flagCalls.push({ ids, update });
			return ids.length;
		},
		ownAddresses: async () => ['Me@Example.com']
	});
	return { service, blocked, flagCalls };
}

describe('setSpam', () => {
	test('marks the whole conversation and blocks its sender', async () => {
		const { service, blocked, flagCalls } = setup();
		assert.equal(await service.setSpam('user-1', ['a'], true), 2);
		assert.deepEqual(flagCalls, [{ ids: ['a', 'b'], update: { spam: true } }]);
		assert.ok(blocked.has('spammer@x.test'));
	});

	test('"Not spam" moves it back and unblocks the sender', async () => {
		const { service, blocked, flagCalls } = setup();
		await service.setSpam('user-1', ['a'], true);
		await service.setSpam('user-1', ['a'], false);
		assert.deepEqual(flagCalls.at(-1)?.update, { spam: false });
		assert.equal(blocked.has('spammer@x.test'), false);
	});

	test("the user's own addresses are never blocked", async () => {
		const { service, blocked } = setup({ senders: ['me@example.com', 'spammer@x.test'] });
		await service.setSpam('user-1', ['a'], true);
		assert.deepEqual([...blocked], ['spammer@x.test']);
	});

	test("someone else's mail can't be touched", async () => {
		const { service, blocked, flagCalls } = setup();
		assert.equal(await service.setSpam('user-2', ['a'], true), 0);
		assert.equal(flagCalls.length, 0);
		assert.equal(blocked.size, 0);
	});
});

describe('isSpamInbound', () => {
	test('a blocked sender is spam, matched case-insensitively', async () => {
		const { service } = setup();
		await service.setSpam('user-1', ['a'], true);
		assert.equal(await service.isSpamInbound('user-1', ' Spammer@X.test ', []), true);
	});

	test('failed authentication is spam even from an unknown sender', async () => {
		const { service } = setup();
		assert.equal(await service.isSpamInbound('user-1', 'new@y.test', ['mx; dmarc=fail']), true);
	});

	test('an unknown sender with passing or missing authentication is not spam', async () => {
		const { service } = setup();
		assert.equal(await service.isSpamInbound('user-1', 'new@y.test', ['mx; spf=pass; dkim=pass']), false);
		assert.equal(await service.isSpamInbound('user-1', 'new@y.test', []), false);
	});
});
