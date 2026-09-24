import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { draftForNew, draftFromEvent, draftToInput } from '../editor';
import type { CalendarEvent } from '../events';

const zone = 'Asia/Jakarta';

describe('event drafts', () => {
	test('a new event today starts at the next whole hour', () => {
		const now = new Date('2026-09-24T03:20:00.000Z'); // 10:20 in Jakarta
		const draft = draftForNew('2026-09-24', zone, now);
		assert.equal(draft.startTime, '11:00');
		assert.equal(draft.endTime, '12:00');
		assert.equal(draft.endDate, '2026-09-24');
	});

	test('a new event on another day starts at nine', () => {
		const draft = draftForNew('2026-10-01', zone, new Date('2026-09-24T03:20:00.000Z'));
		assert.equal(draft.startTime, '09:00');
	});

	test('a late-evening new event ends the next day', () => {
		const draft = draftForNew('2026-09-24', zone, new Date('2026-09-24T15:30:00.000Z')); // 22:30
		assert.equal(draft.startTime, '23:00');
		assert.equal(draft.endTime, '00:00');
		assert.equal(draft.endDate, '2026-09-25');
	});

	test('a timed event round-trips through the zone’s wall time', () => {
		const event: CalendarEvent = {
			id: 'e',
			title: 'Lunch',
			start: '2026-09-24T05:00:00.000Z',
			end: '2026-09-24T06:30:00.000Z',
			allDay: false,
			location: 'Cafe',
			notes: null,
			source: 'manual',
			busy: true,
			calendar: null
		};
		const draft = draftFromEvent(event, zone);
		assert.equal(draft.startTime, '12:00');
		assert.equal(draft.endTime, '13:30');
		const input = draftToInput(draft, zone);
		assert.equal(input.start, event.start);
		assert.equal(input.end, event.end);
		assert.equal(input.location, 'Cafe');
	});

	test('an all-day draft shows an inclusive last day and sends an exclusive one', () => {
		const event: CalendarEvent = {
			id: 'e',
			title: 'Trip',
			start: '2026-09-24T00:00:00.000Z',
			end: '2026-09-27T00:00:00.000Z',
			allDay: true,
			location: null,
			notes: null,
			source: 'manual',
			busy: true,
			calendar: null
		};
		const draft = draftFromEvent(event, zone);
		assert.equal(draft.endDate, '2026-09-26');
		assert.deepEqual(
			{ start: draftToInput(draft, zone).start, end: draftToInput(draft, zone).end },
			{ start: '2026-09-24', end: '2026-09-27' }
		);
	});

	test('an unreadable time becomes an empty string for the server to reject', () => {
		const draft = { ...draftForNew('2026-09-24', zone), startTime: '' };
		assert.equal(draftToInput(draft, zone).start, '');
	});
});
