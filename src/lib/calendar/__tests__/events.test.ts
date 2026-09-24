import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addDays, dateKeyToUtc, eventInterval, validateEventInput } from '../events';

const base = { title: 'Standup', start: '2026-09-24T02:00:00.000Z', end: '2026-09-24T02:30:00.000Z', allDay: false };

describe('validateEventInput', () => {
	test('accepts a timed event and normalises whitespace and empty extras', () => {
		const result = validateEventInput({ ...base, title: '  Team   standup ', location: '  ', notes: ' agenda ' });
		assert.deepEqual(result, {
			ok: true,
			value: {
				title: 'Team standup',
				start: base.start,
				end: base.end,
				allDay: false,
				location: null,
				notes: 'agenda'
			}
		});
	});

	test('rejects a blank title', () => {
		assert.deepEqual(validateEventInput({ ...base, title: '   ' }), { ok: false, error: 'invalid_title' });
	});

	test('rejects an end at or before the start, and garbage times', () => {
		assert.deepEqual(validateEventInput({ ...base, end: base.start }), { ok: false, error: 'invalid_time' });
		assert.deepEqual(validateEventInput({ ...base, start: 'soon' }), { ok: false, error: 'invalid_time' });
	});

	test('rejects an event longer than a year', () => {
		assert.deepEqual(validateEventInput({ ...base, end: '2028-01-01T00:00:00.000Z' }), {
			ok: false,
			error: 'invalid_time'
		});
	});

	test('stores an all-day event as floating UTC midnights', () => {
		const result = validateEventInput({ title: 'Trip', start: '2026-09-24', end: '2026-09-27', allDay: true });
		assert.ok(result.ok);
		assert.equal(result.value.start, '2026-09-24T00:00:00.000Z');
		assert.equal(result.value.end, '2026-09-27T00:00:00.000Z');
	});

	test('rejects an impossible all-day date', () => {
		assert.deepEqual(validateEventInput({ title: 'X', start: '2026-02-30', end: '2026-03-02', allDay: true }), {
			ok: false,
			error: 'invalid_time'
		});
	});
});

describe('date keys', () => {
	test('addDays crosses months and years', () => {
		assert.equal(addDays('2026-12-31', 1), '2027-01-01');
		assert.equal(addDays('2026-03-01', -1), '2026-02-28');
	});

	test('dateKeyToUtc refuses overflowing dates', () => {
		assert.equal(dateKeyToUtc('2026-13-01'), null);
		assert.equal(dateKeyToUtc('2026-09-24')?.toISOString(), '2026-09-24T00:00:00.000Z');
	});
});

describe('eventInterval', () => {
	test('an all-day event covers the zone’s own midnight to midnight', () => {
		const interval = eventInterval(
			{ start: '2026-09-24T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z', allDay: true },
			'Asia/Jakarta'
		);
		assert.equal(interval.start.toISOString(), '2026-09-23T17:00:00.000Z');
		assert.equal(interval.end.toISOString(), '2026-09-24T17:00:00.000Z');
	});

	test('a timed event is its stored instants in any zone', () => {
		const interval = eventInterval(base, 'America/New_York');
		assert.equal(interval.start.toISOString(), base.start);
	});
});
