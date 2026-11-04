import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { relativeTime } from '../schedule';

describe('relativeTime', () => {
	test('picks minutes, hours or days by how far off it is, either way', () => {
		assert.equal(relativeTime(12 * 60_000, 'en'), 'in 12 minutes');
		assert.equal(relativeTime(-5 * 60_000, 'en'), '5 minutes ago');
		assert.equal(relativeTime(3 * 3_600_000, 'en'), 'in 3 hours');
		assert.equal(relativeTime(24 * 3_600_000, 'en'), 'tomorrow');
	});

	test('speaks the reader’s language', () => {
		assert.equal(relativeTime(12 * 60_000, 'fr'), 'dans 12 minutes');
	});
});
