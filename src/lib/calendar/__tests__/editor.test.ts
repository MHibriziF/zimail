import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addGuests, draftForNew, draftFromEvent, draftToInput, guestStatusKey, splitGuestInput } from '../editor';
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
			calendar: null,
			meetingCode: null
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
			calendar: null,
			meetingCode: null
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

	const manual: CalendarEvent = {
		id: 'e',
		title: 'Planning',
		start: '2026-09-24T05:00:00.000Z',
		end: '2026-09-24T06:00:00.000Z',
		allDay: false,
		location: null,
		notes: null,
		source: 'manual',
		busy: true,
		calendar: null,
		meetingCode: 'abc-defg-hij'
	};

	test('guests and the meeting room go from the event to the draft and back', () => {
		const draft = draftFromEvent(manual, zone, [{ email: 'ada@example.com', name: null, status: 'accepted' }]);
		assert.deepEqual(draft.guests, ['ada@example.com']);
		assert.equal(draft.withMeeting, true);
		const input = draftToInput(draft, zone);
		assert.deepEqual(input.guests, ['ada@example.com']);
		assert.equal(input.withMeeting, true);
		const fresh = draftToInput(draftForNew('2026-09-24', zone), zone);
		assert.deepEqual([fresh.guests, fresh.withMeeting], [[], false]);
	});

	test('a guest list that could not be loaded is left out, so saving keeps it', () => {
		const draft = draftFromEvent(manual, zone, null);
		assert.equal(draft.guests, null);
		assert.equal(draftToInput(draft, zone).guests, undefined);
	});

	test('typed or pasted guests are split on commas, semicolons and spaces', () => {
		assert.deepEqual(splitGuestInput(' Ada@Example.com, bo@example.com;cy@example.com\n  '), [
			'ada@example.com',
			'bo@example.com',
			'cy@example.com'
		]);
		assert.deepEqual(splitGuestInput(''), []);
	});

	test('adding guests dedupes, and refuses a bad address or too many', () => {
		assert.deepEqual(addGuests(['ada@example.com'], 'ADA@example.com bo@example.com'), {
			guests: ['ada@example.com', 'bo@example.com'],
			error: null
		});
		assert.deepEqual(addGuests(['ada@example.com'], 'bo@example.com nope'), {
			guests: ['ada@example.com'],
			error: { key: 'calendar.invalidGuest', values: { email: 'nope' } }
		});
		const thirty = Array.from({ length: 30 }, (_, index) => `g${index}@example.com`);
		assert.equal(addGuests(thirty, 'one@example.com').error?.key, 'calendar.tooManyGuests');
	});

	test('each answer has a label; someone just added has none', () => {
		assert.equal(guestStatusKey('accepted'), 'calendar.guestAccepted');
		assert.equal(guestStatusKey('tentative'), 'calendar.guestTentative');
		assert.equal(guestStatusKey('declined'), 'calendar.guestDeclined');
		assert.equal(guestStatusKey('needs-action'), 'calendar.guestInvited');
		assert.equal(guestStatusKey(undefined), null);
	});
});
