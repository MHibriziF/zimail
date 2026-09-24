import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarEvent } from '../events';
import {
	dateKeyIn,
	eventDateKeys,
	firstDayOfWeek,
	groupByDay,
	monthGrid,
	parseMonthParam,
	shiftMonth,
	startOfDayIn
} from '../grid';

function event(partial: Partial<CalendarEvent>): CalendarEvent {
	return {
		id: partial.id ?? 'e',
		title: partial.title ?? 'Event',
		start: partial.start ?? '2026-09-24T02:00:00.000Z',
		end: partial.end ?? '2026-09-24T03:00:00.000Z',
		allDay: partial.allDay ?? false,
		location: null,
		notes: null,
		source: 'manual',
		busy: true
	};
}

describe('monthGrid', () => {
	test('six weeks starting on the week start day', () => {
		const grid = monthGrid({ year: 2026, month: 9 }, 1);
		assert.equal(grid.length, 42);
		// 1 September 2026 is a Tuesday, so a Monday-first grid starts on 31 August.
		assert.equal(grid[0], '2026-08-31');
		assert.equal(grid[41], '2026-10-11');
	});

	test('a Sunday-first grid', () => {
		assert.equal(monthGrid({ year: 2026, month: 9 }, 0)[0], '2026-08-30');
	});
});

describe('month params', () => {
	test('shiftMonth wraps years both ways', () => {
		assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
		assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
	});

	test('parseMonthParam falls back on nonsense', () => {
		const fallback = { year: 2026, month: 9 };
		assert.deepEqual(parseMonthParam('2027-02', fallback), { year: 2027, month: 2 });
		assert.deepEqual(parseMonthParam('2027-13', fallback), fallback);
		assert.deepEqual(parseMonthParam(null, fallback), fallback);
	});

	test('firstDayOfWeek never throws', () => {
		const day = firstDayOfWeek('not a locale!!');
		assert.ok(day >= 0 && day <= 6);
	});
});

describe('days in a zone', () => {
	test('dateKeyIn and startOfDayIn agree', () => {
		const instant = new Date('2026-09-23T18:00:00.000Z');
		assert.equal(dateKeyIn(instant, 'Asia/Jakarta'), '2026-09-24');
		assert.equal(startOfDayIn('2026-09-24', 'Asia/Jakarta').toISOString(), '2026-09-23T17:00:00.000Z');
	});

	test('a timed event lands on the zone’s date, not UTC’s', () => {
		const late = event({ start: '2026-09-23T20:00:00.000Z', end: '2026-09-23T21:00:00.000Z' });
		assert.deepEqual(eventDateKeys(late, 'Asia/Jakarta'), ['2026-09-24']);
		assert.deepEqual(eventDateKeys(late, 'UTC'), ['2026-09-23']);
	});

	test('ending exactly at midnight does not spill into the next day', () => {
		const evening = event({ start: '2026-09-24T22:00:00.000Z', end: '2026-09-25T00:00:00.000Z' });
		assert.deepEqual(eventDateKeys(evening, 'UTC'), ['2026-09-24']);
	});

	test('an all-day event spans its dates in every zone', () => {
		const trip = event({ start: '2026-09-24T00:00:00.000Z', end: '2026-09-27T00:00:00.000Z', allDay: true });
		const expected = ['2026-09-24', '2026-09-25', '2026-09-26'];
		assert.deepEqual(eventDateKeys(trip, 'Pacific/Honolulu'), expected);
		assert.deepEqual(eventDateKeys(trip, 'Asia/Tokyo'), expected);
	});

	test('groupByDay puts all-day first, then by start', () => {
		const later = event({ id: 'later', start: '2026-09-24T05:00:00.000Z', end: '2026-09-24T06:00:00.000Z' });
		const earlier = event({ id: 'earlier' });
		const allDay = event({ id: 'all', start: '2026-09-24T00:00:00.000Z', end: '2026-09-25T00:00:00.000Z', allDay: true });
		const day = groupByDay([later, earlier, allDay], 'UTC').get('2026-09-24');
		assert.deepEqual(day?.map((entry) => entry.id), ['all', 'earlier', 'later']);
	});
});
