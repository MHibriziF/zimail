import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	MAX_REACTIONS_ON_SCREEN,
	REACTIONS,
	REACTION_LIMIT,
	REACTION_WINDOW_MS,
	createReactionLimiter,
	isReaction,
	pushCapped
} from '../reactions';

describe('isReaction', () => {
	test('accepts every offered reaction', () => {
		for (const emoji of REACTIONS) assert.ok(isReaction(emoji), emoji);
	});

	test('rejects anything else, including look-alikes and markup', () => {
		for (const value of ['', '💩', '👍👍', ' 👍', '❤', '<img src=x onerror=alert(1)>']) {
			assert.equal(isReaction(value), false, value);
		}
	});
});

describe('createReactionLimiter', () => {
	test('allows up to the limit within the window, then refuses', () => {
		const limiter = createReactionLimiter();
		for (let i = 0; i < REACTION_LIMIT; i++) assert.ok(limiter.allow('a', 1_000 + i));
		assert.equal(limiter.allow('a', 1_010), false);
	});

	test('frees up again once the window has passed', () => {
		const limiter = createReactionLimiter();
		for (let i = 0; i < REACTION_LIMIT; i++) limiter.allow('a', 1_000);
		assert.equal(limiter.allow('a', 1_000 + REACTION_WINDOW_MS - 1), false);
		assert.ok(limiter.allow('a', 1_000 + REACTION_WINDOW_MS));
	});

	test('refused attempts do not extend the wait', () => {
		const limiter = createReactionLimiter(1, 1_000);
		limiter.allow('a', 0);
		for (let now = 100; now < 1_000; now += 100) limiter.allow('a', now);
		assert.ok(limiter.allow('a', 1_000));
	});

	test('counts each sender separately', () => {
		const limiter = createReactionLimiter(1, 1_000);
		assert.ok(limiter.allow('a', 0));
		assert.ok(limiter.allow('b', 0));
		assert.equal(limiter.allow('a', 1), false);
	});

	test('a clock that jumps backwards does not block the sender', () => {
		const limiter = createReactionLimiter(1, 1_000);
		limiter.allow('a', 50_000);
		assert.ok(limiter.allow('a', 10_000));
	});

	test('forget clears a sender', () => {
		const limiter = createReactionLimiter(1, 1_000);
		limiter.allow('a', 0);
		limiter.forget('a');
		assert.ok(limiter.allow('a', 1));
	});
});

describe('pushCapped', () => {
	test('appends while under the cap', () => {
		assert.deepEqual(pushCapped([1, 2], 3), [1, 2, 3]);
	});

	test('drops the oldest once full', () => {
		const full = Array.from({ length: MAX_REACTIONS_ON_SCREEN }, (_, i) => i);
		const next = pushCapped(full, 99);
		assert.equal(next.length, MAX_REACTIONS_ON_SCREEN);
		assert.equal(next[0], 1);
		assert.equal(next.at(-1), 99);
	});
});
