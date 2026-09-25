import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readInvitation } from '../../../calendar/ics/invite';
import { inviteEmailContent, inviteIcs, inviteMethod, inviteSubject, type EventInvite } from '../email';

const invite: EventInvite = {
	uid: 'e1@zimail',
	sequence: 2,
	title: 'Planning, Q4',
	start: new Date('2026-10-01T02:00:00.000Z'),
	end: new Date('2026-10-01T03:00:00.000Z'),
	allDay: false,
	location: 'Room 4',
	notes: 'Bring numbers\nand ideas',
	organizer: { email: 'me@example.test', name: 'Izi' },
	guests: [
		{ email: 'ada@example.com', name: 'Ada', status: 'accepted' },
		{ email: 'bo@example.com', name: null, status: 'needs-action' }
	],
	timeZone: 'Asia/Jakarta'
};

const now = new Date('2026-09-25T00:00:00.000Z');

describe('event invitation', () => {
	test('a request reads back as the same event, with every guest and their answer', () => {
		const read = readInvitation(inviteIcs(invite, 'new', now), 'UTC');
		assert.equal(read?.method, 'REQUEST');
		assert.equal(read?.uid, 'e1@zimail');
		assert.equal(read?.sequence, 2);
		assert.equal(read?.title, 'Planning, Q4');
		assert.equal(read?.start, invite.start.toISOString());
		assert.equal(read?.location, 'Room 4');
		assert.equal(read?.description, 'Bring numbers\nand ideas');
		assert.deepEqual(read?.organizer, invite.organizer);
		assert.deepEqual(
			read?.attendees.map((guest) => [guest.email, guest.status, guest.rsvp]),
			[
				['ada@example.com', 'accepted', true],
				['bo@example.com', 'needs-action', true]
			]
		);
	});

	test('an update is still a request; a cancellation says so', () => {
		assert.equal(inviteMethod('updated'), 'REQUEST');
		assert.equal(inviteMethod('cancelled'), 'CANCEL');
		const cancel = inviteIcs(invite, 'cancelled', now);
		assert.match(cancel, /\r\nMETHOD:CANCEL\r\n/);
		assert.match(cancel, /\r\nSTATUS:CANCELLED\r\n/);
		assert.equal(readInvitation(cancel, 'UTC')?.method, 'CANCEL');
	});

	test('an all-day event is written as dates', () => {
		const ics = inviteIcs(
			{
				...invite,
				allDay: true,
				start: new Date('2026-10-01T00:00:00.000Z'),
				end: new Date('2026-10-03T00:00:00.000Z')
			},
			'new',
			now
		);
		assert.match(ics, /\r\nDTSTART;VALUE=DATE:20261001\r\n/);
		assert.match(ics, /\r\nDTEND;VALUE=DATE:20261003\r\n/);
	});

	test('the email says what happened and when, in the organizer’s zone', () => {
		const content = inviteEmailContent(invite, 'new');
		assert.equal(content.title, 'Invitation: Planning, Q4');
		assert.match(content.lead, /^Izi invited you/);
		const when = content.details?.find((detail) => detail.label === 'When')?.value ?? '';
		assert.match(when, /9:00\s?AM – 10:00\s?AM \(Asia\/Jakarta\)/);
		assert.deepEqual(
			content.details?.map((detail) => detail.label),
			['When', 'Organizer', 'Where', 'Guests', 'Notes']
		);
		assert.equal(inviteSubject(invite, 'updated'), 'Updated invitation: Planning, Q4');
	});

	test('a cancellation only says when it was and who organized it', () => {
		const content = inviteEmailContent({ ...invite, organizer: { email: 'me@example.test', name: null } }, 'cancelled');
		assert.equal(content.title, 'Cancelled: Planning, Q4');
		assert.match(content.lead, /^me@example\.test cancelled/);
		assert.deepEqual(
			content.details?.map((detail) => detail.label),
			['Was', 'Organizer']
		);
	});

	test('an all-day event spanning days shows its first and last date', () => {
		const content = inviteEmailContent(
			{
				...invite,
				allDay: true,
				start: new Date('2026-10-01T00:00:00.000Z'),
				end: new Date('2026-10-03T00:00:00.000Z')
			},
			'updated'
		);
		assert.equal(content.details?.[0].value, 'Thursday, October 1, 2026 – Friday, October 2, 2026');
		const oneDay = inviteEmailContent(
			{ ...invite, allDay: true, start: new Date('2026-10-01T00:00:00.000Z'), end: new Date('2026-10-02T00:00:00.000Z') },
			'new'
		);
		assert.equal(oneDay.details?.[0].value, 'Thursday, October 1, 2026');
	});
});
