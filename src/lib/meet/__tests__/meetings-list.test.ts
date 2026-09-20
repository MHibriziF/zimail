import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_MEETINGS_SHOWN, MEETINGS_PAGE_SIZE, nextShowCount, parseShowCount } from '../meetings-list';

describe('parseShowCount', () => {
	test('a missing or unreadable value is one page', () => {
		assert.equal(parseShowCount(null), MEETINGS_PAGE_SIZE);
		assert.equal(parseShowCount(''), MEETINGS_PAGE_SIZE);
		assert.equal(parseShowCount('lots'), MEETINGS_PAGE_SIZE);
	});

	test('never returns less than a page, however small the request', () => {
		assert.equal(parseShowCount('0'), MEETINGS_PAGE_SIZE);
		assert.equal(parseShowCount('-99'), MEETINGS_PAGE_SIZE);
	});

	test('passes a sensible request through, flooring fractions', () => {
		assert.equal(parseShowCount('60'), 60);
		assert.equal(parseShowCount('60.9'), 60);
	});

	test('a hand-edited value cannot ask for more than the ceiling', () => {
		assert.equal(parseShowCount('100000'), MAX_MEETINGS_SHOWN);
		assert.equal(parseShowCount('Infinity'), MEETINGS_PAGE_SIZE);
	});
});

describe('nextShowCount', () => {
	test('advances by one page', () => {
		assert.equal(nextShowCount(MEETINGS_PAGE_SIZE), MEETINGS_PAGE_SIZE * 2);
	});

	test('stops at the ceiling rather than growing past it', () => {
		assert.equal(nextShowCount(MAX_MEETINGS_SHOWN), MAX_MEETINGS_SHOWN);
		assert.equal(nextShowCount(MAX_MEETINGS_SHOWN - 1), MAX_MEETINGS_SHOWN);
	});
});
