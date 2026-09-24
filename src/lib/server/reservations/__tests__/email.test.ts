import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { expandCalendar } from '../../../calendar/ics';
import { bookingEmailContent, bookingIcs, inviteContentType, type BookingDetails } from '../email';

const details: BookingDetails = {
	uid: 'abc@zimail',
	pageTitle: 'Office hours; weekly',
	hostName: 'Izi',
	hostEmail: 'me@example.test',
	guestName: 'Ana, from Acme',
	guestEmail: 'ana@example.com',
	note: 'Line one\nLine two',
	start: new Date('2026-09-28T02:00:00.000Z'),
	end: new Date('2026-09-28T03:00:00.000Z'),
	timeZone: 'Asia/Jakarta'
};

describe('calendar invitation', () => {
	const now = new Date('2026-09-24T00:00:00.000Z');

	test('a booking is an iTIP request the guest can accept', () => {
		const ics = bookingIcs(details, 'request', now);
		assert.match(ics, /\r\nMETHOD:REQUEST\r\n/);
		assert.match(ics, /\r\nUID:abc@zimail\r\n/);
		assert.match(ics, /\r\nSEQUENCE:0\r\n/);
		assert.match(ics, /\r\nSTATUS:CONFIRMED\r\n/);
		assert.match(ics, /ORGANIZER;CN="Izi":mailto:me@example.test/);
		// Quoted, so the comma in the guest's name can't split the parameter.
		assert.match(ics.replaceAll('\r\n ', ''), /ATTENDEE;CN="Ana, from Acme";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ana@example.com/);
		assert.equal(inviteContentType('request'), 'text/calendar; method=REQUEST; charset=UTF-8');
	});

	test('a cancellation names the same event with a higher sequence', () => {
		const ics = bookingIcs(details, 'cancel', now);
		assert.match(ics, /\r\nMETHOD:CANCEL\r\n/);
		assert.match(ics, /\r\nUID:abc@zimail\r\n/);
		assert.match(ics, /\r\nSEQUENCE:1\r\n/);
		assert.match(ics, /\r\nSTATUS:CANCELLED\r\n/);
		assert.equal(inviteContentType('cancel'), 'text/calendar; method=CANCEL; charset=UTF-8');

		const content = bookingEmailContent(details, 'cancel');
		assert.match(content.title, /^Cancelled: /);
		assert.ok(content.details?.some((detail) => detail.label === 'Was'));
	});

	test('a meeting room goes in the invitation and the email', () => {
		const withRoom = { ...details, meetingUrl: 'https://mail.test/meet/abc-defg-hij' };
		const lines = bookingIcs(withRoom, 'request', now).replaceAll('\r\n ', '').split('\r\n');
		assert.ok(lines.includes('LOCATION:https://mail.test/meet/abc-defg-hij'));
		assert.ok(lines.includes('URL:https://mail.test/meet/abc-defg-hij'));
		assert.ok(
			lines.includes(String.raw`DESCRIPTION:Join the Zimail meeting: https://mail.test/meet/abc-defg-hij\n\nLine one\nLine two`)
		);

		const content = bookingEmailContent(withRoom);
		assert.deepEqual(content.action, { label: 'Join the meeting', href: 'https://mail.test/meet/abc-defg-hij' });
		assert.ok(content.details?.some((detail) => detail.label === 'Meeting'));
		assert.equal(bookingEmailContent(details).action, undefined);
		assert.ok(!bookingIcs(details, 'request', now).includes('LOCATION:'));
	});

	test('quotes in a name are dropped rather than breaking the parameter', () => {
		const ics = bookingIcs({ ...details, guestName: 'Ana "the" Guest' }, 'request', now);
		assert.match(ics.replaceAll('\r\n ', ''), /ATTENDEE;CN="Ana the Guest";/);
	});
});

describe('booking confirmation', () => {
	test('the email states the time in the page’s zone and includes the note', () => {
		const content = bookingEmailContent(details);
		const when = content.details?.find((detail) => detail.label === 'When')?.value ?? '';
		assert.match(when, /9:00/);
		assert.match(when, /Asia\/Jakarta/);
		assert.ok(content.details?.some((detail) => detail.label === 'Note'));
		assert.ok(!bookingEmailContent({ ...details, note: '' }).details?.some((detail) => detail.label === 'Note'));
	});

	test('the invite escapes text and round-trips through our own parser', () => {
		const ics = bookingIcs(details, 'request', new Date('2026-09-24T00:00:00.000Z'));
		assert.match(ics, /SUMMARY:Office hours\\; weekly with Izi/);
		assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
		assert.ok(ics.split('\r\n').every((line) => line.length <= 75));

		const [event] = expandCalendar(ics, {
			from: new Date('2026-09-01T00:00:00.000Z'),
			to: new Date('2026-10-31T00:00:00.000Z'),
			fallbackTimeZone: 'UTC'
		});
		assert.equal(event.start, '2026-09-28T02:00:00.000Z');
		assert.equal(event.end, '2026-09-28T03:00:00.000Z');
		assert.equal(event.title, 'Office hours; weekly with Izi');
	});
});
