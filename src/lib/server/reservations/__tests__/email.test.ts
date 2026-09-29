import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { expandCalendar } from '../../../calendar/ics';
import { calendarAttachment } from '../../outbound/calendar-mail';
import { bookingEmailContent, bookingIcs, bookingMethod, type BookingDetails } from '../email';

const inviteContentType = (kind: Parameters<typeof bookingMethod>[0]) => calendarAttachment('', bookingMethod(kind)).type;

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

	test('a move is a request for the same event at its next revision', () => {
		const ics = bookingIcs({ ...details, sequence: 2 }, 'moved', now);
		assert.match(ics, /\r\nMETHOD:REQUEST\r\n/);
		assert.match(ics, /\r\nSEQUENCE:2\r\n/);
		assert.match(ics, /\r\nSTATUS:CONFIRMED\r\n/);
		assert.equal(inviteContentType('moved'), 'text/calendar; method=REQUEST; charset=UTF-8');
		assert.match(bookingEmailContent(details, 'moved').title, /^New time: /);
		assert.match(bookingEmailContent(details, 'moved').lead, /moved your reservation/);
		assert.match(bookingIcs({ ...details, sequence: 3 }, 'cancel', now), /\r\nSEQUENCE:3\r\n/);
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

describe('where a booking takes place', () => {
	const now = new Date('2026-09-24T00:00:00.000Z');
	const link = 'https://mail.example/meet/abc-defg-hij';
	/** ICS folds long lines as CRLF + space; undo it so a property reads whole. */
	const unfold = (ics: string) => ics.replaceAll('\r\n ', '');
	const property = (ics: string, name: string) =>
		unfold(ics)
			.split('\r\n')
			.find((line) => line.startsWith(`${name}:`))
			?.slice(name.length + 1);

	test('a place shows as Where and is the calendar location; the link stays as URL', () => {
		const booking = { ...details, location: 'Pacil, room 3.1', meetingUrl: link };
		const rows = bookingEmailContent(booking).details!;
		assert.ok(rows.some((row) => row.label === 'Where' && row.value === 'Pacil, room 3.1'));
		assert.ok(rows.some((row) => row.label === 'Meeting' && row.value === link));
		const ics = bookingIcs(booking, 'request', now);
		assert.equal(property(ics, 'LOCATION'), 'Pacil\\, room 3.1');
		assert.equal(property(ics, 'URL'), link);
	});

	test('without a place, the join link is the location, as before', () => {
		const booking = { ...details, meetingUrl: link };
		assert.equal(property(bookingIcs(booking, 'request', now), 'LOCATION'), link);
		assert.ok(!bookingEmailContent(booking).details!.some((row) => row.label === 'Where'));
	});

	test('a cancellation still says where it was', () => {
		const rows = bookingEmailContent({ ...details, location: 'Pacil' }, 'cancel').details!;
		assert.ok(rows.some((row) => row.label === 'Where' && row.value === 'Pacil'));
	});
});

describe('changes the guest made', () => {
	const now = new Date('2026-09-24T00:00:00.000Z');
	const manage = { url: 'https://mail.example/book/manage/abc', until: new Date('2026-09-27T02:00:00.000Z') };

	test('the confirmation carries the link and says until when it works', () => {
		const content = bookingEmailContent({ ...details, manage });
		assert.ok(content.details!.some((row) => row.label === 'Change or cancel' && row.value === manage.url));
		assert.match(content.footer ?? '', /reschedule or cancel with the link above until Sunday, September 27, 2026/);
	});

	test('wording reads right to the guest and to the host on Bcc', () => {
		const moved = bookingEmailContent(details, 'guest-moved');
		assert.match(moved.title, /^New time: /);
		assert.match(moved.lead ?? '', /^Ana, from Acme moved this reservation/);
		const cancelled = bookingEmailContent(details, 'guest-cancel');
		assert.match(cancelled.title, /^Cancelled: /);
		assert.match(cancelled.lead ?? '', /^Ana, from Acme cancelled this reservation\./);
	});

	test('a guest cancellation is a real calendar cancellation', () => {
		assert.equal(bookingMethod('guest-cancel'), 'CANCEL');
		assert.equal(bookingMethod('guest-moved'), 'REQUEST');
		const ics = bookingIcs({ ...details, sequence: 2 }, 'guest-cancel', now);
		assert.match(ics, /\r\nMETHOD:CANCEL\r\n/);
		assert.match(ics, /\r\nSTATUS:CANCELLED\r\n/);
	});
});
