import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { expandCalendar } from '../../../calendar/ics';
import { bookingEmailContent, bookingIcs, type BookingDetails } from '../email';

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
		const ics = bookingIcs(details, new Date('2026-09-24T00:00:00.000Z'));
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
