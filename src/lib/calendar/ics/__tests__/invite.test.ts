import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findAttendee, readInvitation } from '../invite';

const ics = (lines: string[], method: string | null = 'REQUEST') =>
	['BEGIN:VCALENDAR', 'VERSION:2.0', ...(method ? [`METHOD:${method}`] : []), ...lines, 'END:VCALENDAR'].join('\r\n');

const googleInvite = ics([
	'BEGIN:VTIMEZONE',
	'TZID:Asia/Jakarta',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'DTSTART;TZID=Asia/Jakarta:20260925T103000',
	'DTEND;TZID=Asia/Jakarta:20260925T110000',
	'UID:abc123@google.com',
	'SEQUENCE:2',
	'ORGANIZER;CN=Ada Lovelace:mailto:Ada@Example.com',
	'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=',
	' TRUE;CN=me@zimail.test;X-NUM-GUESTS=0:mailto:me@zimail.test',
	'ATTENDEE;PARTSTAT=ACCEPTED;CN="Lovelace, Ada":mailto:ada@example.com',
	'SUMMARY:Demo TI',
	'LOCATION:Room 1\\, floor 2',
	'DESCRIPTION:Bring the slides\\nand coffee',
	'END:VEVENT'
]);

describe('readInvitation', () => {
	test('reads a Google invitation', () => {
		const invitation = readInvitation(googleInvite, 'UTC')!;
		assert.equal(invitation.method, 'REQUEST');
		assert.equal(invitation.uid, 'abc123@google.com');
		assert.equal(invitation.sequence, 2);
		assert.equal(invitation.title, 'Demo TI');
		assert.equal(invitation.start, '2026-09-25T03:30:00.000Z');
		assert.equal(invitation.end, '2026-09-25T04:00:00.000Z');
		assert.equal(invitation.location, 'Room 1, floor 2');
		assert.equal(invitation.description, 'Bring the slides\nand coffee');
		assert.deepEqual(invitation.organizer, { email: 'ada@example.com', name: 'Ada Lovelace' });
		assert.equal(invitation.attendees.length, 2);
		assert.deepEqual(invitation.attendees[0], { email: 'me@zimail.test', name: 'me@zimail.test', status: 'needs-action', rsvp: true });
		assert.equal(invitation.attendees[1].status, 'accepted');
		assert.equal(invitation.attendees[1].name, 'Lovelace, Ada');
		assert.equal(invitation.recurring, false);
		assert.equal(invitation.occurrenceId, null);
	});

	test('a part without METHOD is a published event', () => {
		const text = ics(['BEGIN:VEVENT', 'UID:x', 'DTSTART:20260101T090000Z', 'DTEND:20260101T100000Z', 'END:VEVENT'], null);
		assert.equal(readInvitation(text, 'UTC')?.method, 'PUBLISH');
	});

	test('an unknown method, or no event, reads as nothing', () => {
		assert.equal(readInvitation(ics(['BEGIN:VEVENT', 'UID:x', 'DTSTART:20260101T090000Z', 'END:VEVENT'], 'ADD2'), 'UTC'), null);
		assert.equal(readInvitation(ics([]), 'UTC'), null);
	});

	test('a series is recurring; its instance names the occurrence it replaces', () => {
		const series = ics([
			'BEGIN:VEVENT',
			'UID:weekly',
			'DTSTART:20260105T090000Z',
			'DTEND:20260105T093000Z',
			'RRULE:FREQ=WEEKLY',
			'END:VEVENT'
		]);
		assert.equal(readInvitation(series, 'UTC')?.recurring, true);

		const moved = ics([
			'BEGIN:VEVENT',
			'UID:weekly',
			'RECURRENCE-ID:20260112T090000Z',
			'DTSTART:20260113T090000Z',
			'DTEND:20260113T093000Z',
			'END:VEVENT'
		]);
		const invitation = readInvitation(moved, 'UTC')!;
		assert.equal(invitation.occurrenceId, `weekly#${Date.UTC(2026, 0, 12, 9)}`);
		assert.equal(invitation.start, '2026-01-13T09:00:00.000Z');
	});

	test('the invited address is found among the attendees', () => {
		const invitation = readInvitation(googleInvite, 'UTC')!;
		assert.equal(findAttendee(invitation, new Set(['me@zimail.test']))?.email, 'me@zimail.test');
		assert.equal(findAttendee(invitation, new Set(['other@zimail.test'])), null);
	});
});
