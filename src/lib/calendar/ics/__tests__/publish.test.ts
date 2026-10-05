import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { publishedCalendar, publishedUid, type PublishedEvent } from '../publish';

const event = (overrides: Partial<PublishedEvent> = {}): PublishedEvent => ({
	id: 'ev1',
	title: 'Planning, round 2',
	start: '2026-10-06T09:00:00.000Z',
	end: '2026-10-06T10:00:00.000Z',
	allDay: false,
	location: 'Room 4',
	notes: 'Bring the numbers',
	busy: true,
	meetingUrl: null,
	...overrides
});

const options = { calendarName: 'Zimail', busyOnly: false, busyLabel: 'Busy', now: new Date('2026-10-05T00:00:00Z') };

describe('published calendar', () => {
	test('one VEVENT per event, with escaped text and UTC times', () => {
		const ics = publishedCalendar([event(), event({ id: 'ev2' })], options);
		assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
		assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
		assert.match(ics, /METHOD:PUBLISH/);
		assert.match(ics, /SUMMARY:Planning\\, round 2/);
		assert.match(ics, /DTSTART:20261006T090000Z/);
		assert.match(ics, /LOCATION:Room 4/);
		assert.match(ics, /TRANSP:OPAQUE/);
	});

	test('all-day events are dates, and free time is transparent', () => {
		const ics = publishedCalendar(
			[event({ allDay: true, start: '2026-10-06T00:00:00.000Z', end: '2026-10-07T00:00:00.000Z', busy: false })],
			options
		);
		assert.match(ics, /DTSTART;VALUE=DATE:20261006/);
		assert.match(ics, /DTEND;VALUE=DATE:20261007/);
		assert.match(ics, /TRANSP:TRANSPARENT/);
	});

	test('busy-only hides the title, place, notes and meeting link', () => {
		const ics = publishedCalendar([event({ meetingUrl: 'https://mail.example/meet/abc' })], { ...options, busyOnly: true });
		assert.match(ics, /SUMMARY:Busy/);
		assert.doesNotMatch(ics, /Planning|Room 4|Bring the numbers|meet\/abc/);
	});

	test('a meeting room is linked and stands in for a missing place', () => {
		const ics = publishedCalendar([event({ location: null, meetingUrl: 'https://mail.example/meet/abc' })], options);
		assert.match(ics, /URL:https:\/\/mail.example\/meet\/abc/);
		assert.match(ics, /LOCATION:https:\/\/mail.example\/meet\/abc/);
	});

	test('the UID is stable and differs from an invitation’s', () => {
		assert.equal(publishedUid('ev1'), publishedUid('ev1'));
		assert.match(publishedCalendar([event()], options), /UID:ev1@published\.zimail/);
	});
});
