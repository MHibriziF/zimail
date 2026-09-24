import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { InviteEventRow, StoredInvite } from '../repository';
import { createInvitationsService, type InvitationsServiceDeps } from '../service';
import { replyIcs } from '../email';
import { readInvitation } from '../../../calendar/ics/invite';

const ME = 'me@zimail.test';

function invite({
	method = 'REQUEST',
	uid = 'meet-1',
	sequence = 0,
	start = '20260925T033000Z',
	end = '20260925T040000Z',
	extra = [] as string[],
	attendee = ME
} = {}) {
	return [
		'BEGIN:VCALENDAR',
		`METHOD:${method}`,
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`SEQUENCE:${sequence}`,
		`DTSTART:${start}`,
		`DTEND:${end}`,
		'SUMMARY:Demo',
		'ORGANIZER;CN=Ada:mailto:ada@example.com',
		`ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee}`,
		...extra,
		'END:VEVENT',
		'END:VCALENDAR'
	].join('\r\n');
}

function setup(messages: Record<string, string>) {
	const invites = new Map<string, StoredInvite>();
	const events = new Map<string, InviteEventRow[]>();
	const replies: string[] = [];

	const repo: InvitationsServiceDeps['repo'] = {
		async get(_userId, uid) {
			return invites.get(uid) ?? null;
		},
		async save(_userId, stored) {
			invites.set(stored.uid, stored);
		},
		async hasEvents(_userId, uid) {
			return (events.get(uid) ?? []).length > 0;
		},
		async replaceEvents(_userId, uid, rows) {
			events.set(uid, rows);
		},
		async replaceOccurrence(_userId, uid, externalUid, row) {
			const kept = (events.get(uid) ?? []).filter((entry) => entry.externalUid !== externalUid);
			events.set(uid, row ? [...kept, row] : kept);
		},
		async removeEvents(_userId, uid) {
			events.delete(uid);
		}
	};

	const service = createInvitationsService({
		repo,
		loadCalendarPart: async (_userId, emailId) => messages[emailId] ?? null,
		ownAddresses: async () => [ME],
		timeZone: async () => 'Asia/Jakarta',
		async sendReply(_userId, invitation, attendee, response) {
			replies.push(`${response}:${attendee.email}->${invitation.organizer?.email}`);
		},
		now: () => new Date('2026-09-20T00:00:00Z')
	});
	return { service, invites, events, replies };
}

describe('invitations service', () => {
	test('shows an unanswered invitation that is not on the calendar', async () => {
		const { service } = setup({ m1: invite() });
		const view = await service.inspect('u1', 'm1');
		assert.equal(view?.title, 'Demo');
		assert.equal(view?.onCalendar, false);
		assert.equal(view?.response, null);
		assert.equal(view?.canReply, true);
	});

	test('accepting puts it on the calendar and tells the organizer', async () => {
		const { service, events, replies } = setup({ m1: invite() });
		const outcome = await service.act('u1', 'm1', 'accepted');
		assert.equal(outcome.type, 'ok');
		assert.equal(outcome.type === 'ok' && outcome.replied, true);
		assert.equal(outcome.type === 'ok' && outcome.view.response, 'accepted');
		assert.equal(events.get('meet-1')?.length, 1);
		assert.equal(events.get('meet-1')?.[0].start, '2026-09-25T03:30:00.000Z');
		assert.deepEqual(replies, [`accepted:${ME}->ada@example.com`]);
	});

	test('declining takes it off again', async () => {
		const { service, events } = setup({ m1: invite() });
		await service.act('u1', 'm1', 'accepted');
		await service.act('u1', 'm1', 'declined');
		assert.equal(events.has('meet-1'), false);
	});

	test('a repeating invitation is filled in occurrence by occurrence', async () => {
		const { service, events } = setup({ m1: invite({ extra: ['RRULE:FREQ=WEEKLY;COUNT=4'] }) });
		await service.act('u1', 'm1', 'accepted');
		assert.equal(events.get('meet-1')?.length, 4);
	});

	test('not being among the attendees means adding, not answering', async () => {
		const { service, events, replies } = setup({ m1: invite({ attendee: 'someone@else.test' }) });
		assert.equal((await service.inspect('u1', 'm1'))?.canReply, false);
		assert.equal((await service.act('u1', 'm1', 'accepted')).type, 'unsupported');
		assert.equal((await service.act('u1', 'm1', 'add')).type, 'ok');
		assert.equal(events.get('meet-1')?.length, 1);
		assert.deepEqual(replies, []);
	});

	test('an older revision opened later cannot undo a newer one', async () => {
		const { service } = setup({ old: invite({ sequence: 0 }), newer: invite({ sequence: 2 }) });
		await service.act('u1', 'newer', 'accepted');
		assert.equal((await service.inspect('u1', 'old'))?.outdated, true);
		assert.equal((await service.act('u1', 'old', 'declined')).type, 'outdated');
	});

	test('an update from the organizer moves an accepted invitation on arrival', async () => {
		const { service, events } = setup({ m1: invite() });
		await service.act('u1', 'm1', 'accepted');
		const moved = invite({ sequence: 1, start: '20260925T063000Z', end: '20260925T070000Z' });
		assert.equal(await service.applyArrival('u1', moved), 'applied');
		assert.equal(events.get('meet-1')?.[0].start, '2026-09-25T06:30:00.000Z');
	});

	test('a cancellation takes an accepted invitation off on arrival', async () => {
		const { service, events } = setup({ m1: invite() });
		await service.act('u1', 'm1', 'accepted');
		assert.equal(await service.applyArrival('u1', invite({ method: 'CANCEL', sequence: 1 })), 'applied');
		assert.equal(events.has('meet-1'), false);
	});

	test('an invitation never acted on is left alone when updates arrive', async () => {
		const { service, events } = setup({});
		assert.equal(await service.applyArrival('u1', invite({ sequence: 1 })), 'ignored');
		assert.equal(events.size, 0);
	});

	test('a declined invitation is not put back by an update', async () => {
		const { service, events } = setup({ m1: invite() });
		await service.act('u1', 'm1', 'declined');
		assert.equal(await service.applyArrival('u1', invite({ sequence: 1 })), 'ignored');
		assert.equal(events.has('meet-1'), false);
	});

	test('a moved occurrence replaces just that one', async () => {
		const { service, events } = setup({ m1: invite({ extra: ['RRULE:FREQ=WEEKLY;COUNT=3'] }) });
		await service.act('u1', 'm1', 'accepted');
		const moved = invite({
			sequence: 1,
			start: '20261002T063000Z',
			end: '20261002T070000Z',
			extra: ['RECURRENCE-ID:20261002T033000Z']
		});
		assert.equal(await service.applyArrival('u1', moved), 'applied');
		const starts = (events.get('meet-1') ?? []).map((row) => row.start).sort();
		assert.deepEqual(starts, ['2026-09-25T03:30:00.000Z', '2026-10-02T06:30:00.000Z', '2026-10-09T03:30:00.000Z']);
	});
});

describe('replyIcs', () => {
	test('answers with the same UID and sequence, and only the answering attendee', () => {
		const invitation = readInvitation(invite({ sequence: 3 }), 'UTC')!;
		const text = replyIcs(invitation, { email: ME, name: 'Me' }, 'tentative', new Date('2026-09-20T00:00:00Z'));
		assert.match(text, /METHOD:REPLY/);
		assert.match(text, /UID:meet-1/);
		assert.match(text, /SEQUENCE:3/);
		assert.match(text, /ATTENDEE;CN="Me";PARTSTAT=TENTATIVE:mailto:me@zimail\.test/);
		assert.match(text, /ORGANIZER;CN="Ada":mailto:ada@example\.com/);
		assert.equal(text.match(/ATTENDEE/g)?.length, 1);
	});
});
