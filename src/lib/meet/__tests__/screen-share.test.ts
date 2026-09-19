import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	SIMULTANEOUS_SHARE_WINDOW_MS,
	parseScreenShareMode,
	parseScreenSharePolicy,
	pickFeaturedShare,
	shouldYieldScreenShare
} from '../screen-share';

describe('parsing settings', () => {
	test('accepts the known values', () => {
		assert.equal(parseScreenSharePolicy('approval'), 'approval');
		assert.equal(parseScreenShareMode('single'), 'single');
	});

	test('rejects anything else', () => {
		assert.equal(parseScreenSharePolicy('anyone'), undefined);
		assert.equal(parseScreenSharePolicy(true), undefined);
		assert.equal(parseScreenShareMode(undefined), undefined);
	});
});

describe('pickFeaturedShare', () => {
	test('nothing is featured when no one is sharing', () => {
		assert.equal(pickFeaturedShare([], null, 'local'), null);
	});

	test('the newest share is featured', () => {
		assert.equal(pickFeaturedShare(['a', 'b', 'c'], null, 'local'), 'c');
	});

	test('a pinned share wins over a newer one', () => {
		assert.equal(pickFeaturedShare(['a', 'b', 'c'], 'a', 'local'), 'a');
	});

	test('a pin on a share that ended falls back to the newest', () => {
		assert.equal(pickFeaturedShare(['b', 'c'], 'a', 'local'), 'c');
	});

	test("your own share isn't featured over someone else's, even if newer", () => {
		assert.equal(pickFeaturedShare(['a', 'local'], null, 'local'), 'a');
	});

	test('your own share is featured when it is the only one', () => {
		assert.equal(pickFeaturedShare(['local'], null, 'local'), 'local');
	});

	test('you can still pin your own share', () => {
		assert.equal(pickFeaturedShare(['a', 'local'], 'local', 'local'), 'local');
	});
});

describe('shouldYieldScreenShare', () => {
	test('yields to a share that started well after ours', () => {
		assert.equal(
			shouldYieldScreenShare({ ownStartedAt: 0, now: SIMULTANEOUS_SHARE_WINDOW_MS, ownIdentity: 'z', otherIdentity: 'a' }),
			true
		);
	});

	test('exactly one side yields when both start at the same moment', () => {
		const a = shouldYieldScreenShare({ ownStartedAt: 0, now: 100, ownIdentity: 'a', otherIdentity: 'b' });
		const b = shouldYieldScreenShare({ ownStartedAt: 0, now: 100, ownIdentity: 'b', otherIdentity: 'a' });
		assert.notEqual(a, b);
	});
});
