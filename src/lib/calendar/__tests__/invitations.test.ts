import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatInvitationWhen, otherGuests, type InvitationView } from '../invitations';

const base: InvitationView = {
	method: 'REQUEST',
	title: 'Demo',
	start: '2026-09-25T03:30:00.000Z',
	end: '2026-09-25T04:00:00.000Z',
	allDay: false,
	location: null,
	description: null,
	organizer: { email: 'ada@example.com', name: 'Ada' },
	attendees: [
		{ email: 'ada@example.com', name: 'Ada', status: 'accepted', rsvp: false },
		{ email: 'me@zimail.test', name: null, status: 'needs-action', rsvp: true },
		{ email: 'grace@example.com', name: 'Grace', status: 'needs-action', rsvp: true }
	],
	me: 'me@zimail.test',
	recurring: false,
	occurrence: false,
	response: null,
	onCalendar: false,
	outdated: false,
	canReply: true
};

describe('formatInvitationWhen', () => {
	test('a timed event reads as one day with a time range, in the reader zone', () => {
		assert.equal(formatInvitationWhen(base, 'en-US', 'Asia/Jakarta'), 'Fri, Sep 25 · 10:30 AM – 11:00 AM');
	});

	test('an event crossing midnight names both days', () => {
		const late = { ...base, start: '2026-09-25T16:00:00.000Z', end: '2026-09-25T18:00:00.000Z' };
		assert.equal(formatInvitationWhen(late, 'en-US', 'Asia/Jakarta'), 'Fri, Sep 25 11:00 PM – Sat, Sep 26 1:00 AM');
	});

	test('all-day dates are floating, and a multi-day one shows its last day', () => {
		const oneDay = { ...base, allDay: true, start: '2026-09-25T00:00:00.000Z', end: '2026-09-26T00:00:00.000Z' };
		assert.equal(formatInvitationWhen(oneDay, 'en-US', 'America/Los_Angeles'), 'Fri, Sep 25');
		const threeDays = { ...oneDay, end: '2026-09-28T00:00:00.000Z' };
		assert.equal(formatInvitationWhen(threeDays, 'en-US', 'America/Los_Angeles'), 'Fri, Sep 25 – Sun, Sep 27');
	});
});

describe('otherGuests', () => {
	test('leaves out the organizer and the reader', () => {
		assert.deepEqual(
			otherGuests(base).map((guest) => guest.email),
			['grace@example.com']
		);
	});
});
