import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { get } from 'svelte/store';
import {
	dismissOutgoing,
	holdSend,
	isSendPending,
	outgoing,
	sendNow,
	takeRestored,
	undoSend,
	type HeldSend
} from '../undo-send';

function held(overrides: Partial<HeldSend<{ body: string }>> = {}) {
	const calls = { sent: 0, reopened: 0 };
	const entry: HeldSend<{ body: string }> = {
		key: 'compose',
		snapshot: { body: 'hello' },
		send: async () => {
			calls.sent += 1;
			return '/mail/1';
		},
		reopen: () => {
			calls.reopened += 1;
		},
		describeError: () => 'failed',
		...overrides
	};
	return { entry, calls };
}

afterEach(() => {
	undoSend();
	takeRestored('compose');
	takeRestored('other');
	dismissOutgoing();
});

describe('undo send', () => {
	test('holds the message without sending it', () => {
		const { entry, calls } = held();
		holdSend(entry);
		assert.equal(calls.sent, 0);
		assert.deepEqual(get(outgoing), { phase: 'holding' });
		assert.equal(isSendPending(), true);
	});

	test('undo never sends, and gives the snapshot back to the composer', () => {
		const { entry, calls } = held();
		holdSend(entry);
		undoSend();
		assert.equal(calls.sent, 0);
		assert.equal(calls.reopened, 1);
		assert.equal(get(outgoing), null);
		assert.equal(isSendPending(), false);
		assert.deepEqual(takeRestored('compose'), { key: 'compose', snapshot: { body: 'hello' }, error: null });
	});

	test('the snapshot only goes to the composer that sent it, and only once', () => {
		holdSend(held().entry);
		undoSend();
		assert.equal(takeRestored('other'), null);
		assert.notEqual(takeRestored('compose'), null);
		assert.equal(takeRestored('compose'), null);
	});

	test('sending reports where to view the message', async () => {
		const { entry, calls } = held();
		holdSend(entry);
		sendNow();
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(calls.sent, 1);
		assert.deepEqual(get(outgoing), { phase: 'sent', viewHref: '/mail/1' });
		assert.equal(isSendPending(), false);
	});

	test('a failed send reopens the composer with the error', async () => {
		const { entry, calls } = held({
			send: async () => {
				throw new Error('boom');
			}
		});
		holdSend(entry);
		sendNow();
		await Promise.resolve();
		await Promise.resolve();
		assert.deepEqual(get(outgoing), { phase: 'failed' });
		assert.equal(calls.reopened, 1);
		assert.deepEqual(takeRestored('compose'), { key: 'compose', snapshot: { body: 'hello' }, error: 'failed' });
	});

	test('a second send while one is held sends the first at once', async () => {
		const first = held();
		const second = held({ key: 'other' });
		holdSend(first.entry);
		holdSend(second.entry);
		await Promise.resolve();
		assert.equal(first.calls.sent, 1);
		assert.equal(second.calls.sent, 0);
		assert.deepEqual(get(outgoing), { phase: 'holding' });
	});

	test('undo after the message has gone does nothing', async () => {
		const { entry, calls } = held();
		holdSend(entry);
		sendNow();
		undoSend();
		await Promise.resolve();
		assert.equal(calls.sent, 1);
		assert.equal(calls.reopened, 0);
	});
});
