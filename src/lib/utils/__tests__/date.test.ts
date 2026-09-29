import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatFullDate, formatMailTime, formatRelativeDate, parseTimestamp, shouldShowSeparateTime } from '../date';

describe('parseTimestamp', () => {
	test('SQLite’s zone-less timestamps are UTC, not local time', () => {
		assert.equal(parseTimestamp('2026-09-29 15:06:00').toISOString(), '2026-09-29T15:06:00.000Z');
		assert.equal(parseTimestamp('2026-09-29 15:06').toISOString(), '2026-09-29T15:06:00.000Z');
		assert.equal(parseTimestamp('2026-09-29 15:06:00.25').toISOString(), '2026-09-29T15:06:00.250Z');
	});

	test('ISO strings keep their own zone', () => {
		assert.equal(parseTimestamp('2026-09-29T15:06:00.000Z').toISOString(), '2026-09-29T15:06:00.000Z');
		assert.equal(parseTimestamp('2026-09-29T22:06:00+07:00').toISOString(), '2026-09-29T15:06:00.000Z');
	});
});

describe('mail times in the reader’s zone', () => {
	const stored = '2026-09-29 15:06:00';

	test('a message stored at 15:06 UTC reads 10:06 PM in Jakarta and 3:06 PM in UTC', () => {
		assert.equal(formatMailTime(stored, 'en', 'Asia/Jakarta'), '10:06 PM');
		assert.equal(formatMailTime(stored, 'en', 'UTC'), '3:06 PM');
	});

	test('the full date follows the zone across midnight', () => {
		const lateInUtc = '2026-09-29 20:30:00';
		assert.match(formatFullDate(lateInUtc, 'en', 'Asia/Jakarta'), /Wed, Sep 30.*3:30/);
		assert.match(formatFullDate(lateInUtc, 'en', 'UTC'), /Tue, Sep 29.*8:30/);
	});

	test('a message from an hour ago shows its time; a bad value shows nothing', () => {
		const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
		assert.match(formatRelativeDate(hourAgo, 'en', 'UTC'), /\d{1,2}:\d{2}|\w{3}/);
		assert.equal(formatRelativeDate('not a date', 'en', 'UTC'), '');
		assert.equal(formatMailTime('not a date', 'en', 'UTC'), '');
	});

	test('"today" is the reader’s today, not the server’s', () => {
		const justNow = new Date(Date.now() - 5 * 60_000).toISOString();
		assert.equal(shouldShowSeparateTime(justNow, 'Asia/Jakarta'), false);
		const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString();
		assert.equal(shouldShowSeparateTime(lastWeek, 'Asia/Jakarta'), true);
	});
});
