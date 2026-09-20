import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	SHARE_REQUEST_CHIME_WINDOW_MS,
	SHARE_REQUEST_COOLDOWN_MS,
	cooldownRemainingMs,
	cooldownSecondsLeft,
	createRequestChimeGate
} from '../share-request-throttle';

describe('cooldownRemainingMs', () => {
	test('there is no cooldown before a decline', () => {
		assert.equal(cooldownRemainingMs(null, 1_000), 0);
	});

	test('counts down from the decline and ends exactly on the window', () => {
		assert.equal(cooldownRemainingMs(1_000, 1_000), SHARE_REQUEST_COOLDOWN_MS);
		assert.equal(cooldownRemainingMs(1_000, 1_000 + SHARE_REQUEST_COOLDOWN_MS - 1), 1);
		assert.equal(cooldownRemainingMs(1_000, 1_000 + SHARE_REQUEST_COOLDOWN_MS), 0);
	});

	test('never goes negative once the window has passed', () => {
		assert.equal(cooldownRemainingMs(1_000, 10_000_000), 0);
	});

	test('a clock that jumped backwards restarts the window rather than stranding the button', () => {
		assert.equal(cooldownRemainingMs(50_000, 1_000), SHARE_REQUEST_COOLDOWN_MS);
	});
});

describe('cooldownSecondsLeft', () => {
	test('rounds up, so the label never shows 0 while the button is still locked', () => {
		assert.equal(cooldownSecondsLeft(0, SHARE_REQUEST_COOLDOWN_MS - 1), 1);
		assert.equal(cooldownSecondsLeft(0, SHARE_REQUEST_COOLDOWN_MS - 1001), 2);
		assert.equal(cooldownSecondsLeft(0, SHARE_REQUEST_COOLDOWN_MS), 0);
	});
});

describe('createRequestChimeGate', () => {
	test('rings for a first request', () => {
		const gate = createRequestChimeGate();
		assert.equal(gate.shouldRing('guest-1', 0), true);
	});

	test('stays silent for a repeat inside the window, then rings again after it', () => {
		const gate = createRequestChimeGate();
		gate.shouldRing('guest-1', 0);
		assert.equal(gate.shouldRing('guest-1', SHARE_REQUEST_CHIME_WINDOW_MS - 1), false);
		assert.equal(gate.shouldRing('guest-1', SHARE_REQUEST_CHIME_WINDOW_MS), true);
	});

	test('a silenced repeat does not push the window further out', () => {
		const gate = createRequestChimeGate(1_000);
		gate.shouldRing('guest-1', 0);
		// Spamming every 100ms must not keep the gate shut past the original window.
		for (let now = 100; now < 1_000; now += 100) {
			assert.equal(gate.shouldRing('guest-1', now), false);
		}
		assert.equal(gate.shouldRing('guest-1', 1_000), true);
	});

	test('each identity is throttled on its own', () => {
		const gate = createRequestChimeGate();
		assert.equal(gate.shouldRing('guest-1', 0), true);
		assert.equal(gate.shouldRing('guest-2', 0), true);
		assert.equal(gate.shouldRing('guest-1', 1), false);
	});

	test('forgetting an identity lets their next request ring', () => {
		const gate = createRequestChimeGate();
		gate.shouldRing('guest-1', 0);
		gate.forget('guest-1');
		assert.equal(gate.shouldRing('guest-1', 1), true);
	});
});
