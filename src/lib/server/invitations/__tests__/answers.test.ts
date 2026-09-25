import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarEvent } from '../../../calendar/events';
import type { OwnEvent } from '../repository';
import { createAnswersService, ownEventId } from '../answers';
import { declineCounterIcs } from '../email';
import { readInvitation } from '../../../calendar/ics/invite';

function message({
	method = 'COUNTER',
	uid = 'ev-1@zimail',
	sequence = 0,
	partstat = 'NEEDS-ACTION',
	start = '20260925T033000Z',
	end = '20260925T040000Z',
	extra = [] as string[]
} = {}) {
	return [
		'BEGIN:VCALENDAR',
		`METHOD:${method}`,
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`SEQUENCE:${sequence}`,
		`DTSTART:${start}`,
		`DTEND:${end}`,
		'SUMMARY:Demo TI with Me',
		'ORGANIZER;CN=Me:mailto:me@zimail.test',
		`ATTENDEE;CN=Guest;PARTSTAT=${partstat}:mailto:Guest@Gmail.test`,
		...extra,
		'END:VEVENT',
		'END:VCALENDAR'
	].join('\r\n');
}

function setup(messages: Record<string, string>, event: Partial<OwnEvent> | null = {}, others: CalendarEvent[] = []) {
	const own: OwnEvent | null = event && {
		id: 'ev-1',
		title: 'Guest · Demo TI',
		start: '2026-09-24T03:00:00.000Z',
		end: '2026-09-24T03:30:00.000Z',
		allDay: false,
		source: 'reservation',
		sequence: 0,
		...event
	};
	const statuses: string[] = [];
	const moves: string[] = [];
	const declines: string[] = [];

	const service = createAnswersService({
		repo: {
			async findOwnEvent(_userId, eventId) {
				return own && own.id === eventId ? { ...own } : null;
			},
			async setGuestStatus(_userId, eventId, email, status) {
				statuses.push(`${eventId}:${email}:${status}`);
				return email === 'guest@gmail.test';
			}
		},
		loadCalendarPart: async (_userId, emailId) => messages[emailId] ?? null,
		timeZone: async () => 'Asia/Jakarta',
		async reschedule(_userId, target, start, end) {
			if (start.toISOString() === '2026-09-26T03:30:00.000Z') return 'slot_taken';
			moves.push(`${target.id}:${start.toISOString()}`);
			if (own) Object.assign(own, { start: start.toISOString(), end: end.toISOString(), sequence: own.sequence + 1 });
			return 'ok';
		},
		async declineProposal(_userId, target, _proposal, guest) {
			declines.push(`${target.id}:${guest.email}`);
		},
		eventsBetween: async () => [...others, ...(own ? [{ ...own, location: null, notes: null, busy: true, calendar: null, meetingCode: null }] : [])]
	});
	return { service, statuses, moves, declines };
}

describe('ownEventId', () => {
	test('reads the event id out of the UIDs Zimail sends, and nothing else', () => {
		assert.equal(ownEventId('ev-1@zimail'), 'ev-1');
		assert.equal(ownEventId('abc@google.com'), null);
		assert.equal(ownEventId('@zimail'), null);
	});
});

describe('answers service', () => {
	test('a proposed time shows next to the current one', async () => {
		const { service } = setup({ m1: message({ extra: ['COMMENT:Can we do Friday?'] }) });
		const answer = await service.inspect('u1', 'm1');
		assert.equal(answer?.method, 'COUNTER');
		assert.deepEqual(answer?.from, { email: 'guest@gmail.test', name: 'Guest' });
		assert.equal(answer?.title, 'Guest · Demo TI');
		assert.deepEqual(answer?.current, { start: '2026-09-24T03:00:00.000Z', end: '2026-09-24T03:30:00.000Z', allDay: false });
		assert.deepEqual(answer?.proposed, { start: '2026-09-25T03:30:00.000Z', end: '2026-09-25T04:00:00.000Z', allDay: false });
		assert.equal(answer?.comment, 'Can we do Friday?');
		assert.equal(answer?.applied, false);
		assert.equal(answer?.outdated, false);
	});

	test('accepting moves the event, after which the proposal reads as applied', async () => {
		const { service, moves } = setup({ m1: message() });
		const outcome = await service.act('u1', 'm1', 'accept-proposal');
		assert.equal(outcome.type, 'ok');
		assert.deepEqual(moves, ['ev-1:2026-09-25T03:30:00.000Z']);
		assert.equal(outcome.type === 'ok' && outcome.answer.applied, true);
		assert.equal((await service.act('u1', 'm1', 'accept-proposal')).type, 'unsupported');
	});

	test('a proposed time that clashes with the calendar is shown as such and cannot be accepted', async () => {
		const standup: CalendarEvent = {
			id: 'other',
			title: 'Standup',
			start: '2026-09-25T03:45:00.000Z',
			end: '2026-09-25T04:15:00.000Z',
			allDay: false,
			location: null,
			notes: null,
			source: 'manual',
			busy: true,
			calendar: null,
			meetingCode: null
		};
		const { service, moves } = setup({ m1: message() }, {}, [standup]);
		const answer = await service.inspect('u1', 'm1');
		assert.deepEqual(answer?.conflicts, [
			{ title: 'Standup', start: standup.start, end: standup.end, allDay: false }
		]);
		assert.equal((await service.act('u1', 'm1', 'accept-proposal')).type, 'conflict');
		assert.deepEqual(moves, []);
		assert.equal((await service.act('u1', 'm1', 'decline-proposal')).type, 'ok', 'keeping the time is still offered');
	});

	test('free time, the event being moved, and events that merely touch the slot do not clash', async () => {
		const base = { location: null, notes: null, source: 'feed' as const, calendar: null, meetingCode: null, allDay: false };
		const free: CalendarEvent = { ...base, id: 'free', title: 'Focus', start: '2026-09-25T03:30:00.000Z', end: '2026-09-25T04:00:00.000Z', busy: false };
		const before: CalendarEvent = { ...base, id: 'before', title: 'Earlier', start: '2026-09-25T03:00:00.000Z', end: '2026-09-25T03:30:00.000Z', busy: true };
		const after: CalendarEvent = { ...base, id: 'after', title: 'Later', start: '2026-09-25T04:00:00.000Z', end: '2026-09-25T04:30:00.000Z', busy: true };
		const { service } = setup({ m1: message() }, { start: '2026-09-25T03:30:00.000Z', end: '2026-09-25T04:00:00.000Z' }, [free, before, after]);
		assert.deepEqual((await service.inspect('u1', 'm1'))?.conflicts, []);
	});

	test('an all-day busy event clashes across the whole day in the user’s zone', async () => {
		const offsite: CalendarEvent = {
			id: 'offsite',
			title: 'Offsite',
			// Floating 25 September: in Jakarta that's 24 Sep 17:00Z – 25 Sep 17:00Z.
			start: '2026-09-25T00:00:00.000Z',
			end: '2026-09-26T00:00:00.000Z',
			allDay: true,
			location: null,
			notes: null,
			source: 'manual',
			busy: true,
			calendar: null,
			meetingCode: null
		};
		const { service } = setup({ m1: message() }, {}, [offsite]);
		assert.equal((await service.inspect('u1', 'm1'))?.conflicts.length, 1);
	});

	test('a slot another booking holds is refused', async () => {
		const { service } = setup({ m1: message({ start: '20260926T033000Z', end: '20260926T040000Z' }) });
		assert.equal((await service.act('u1', 'm1', 'accept-proposal')).type, 'slot_taken');
	});

	test('declining tells the guest and leaves the event alone', async () => {
		const { service, moves, declines } = setup({ m1: message() });
		const outcome = await service.act('u1', 'm1', 'decline-proposal');
		assert.equal(outcome.type, 'ok');
		assert.deepEqual(declines, ['ev-1:guest@gmail.test']);
		assert.deepEqual(moves, []);
	});

	test('a decline that cannot be sent says so rather than pretending', async () => {
		const { service } = setup({ m1: message() });
		const failing = createAnswersService({
			repo: { findOwnEvent: async () => ({ id: 'ev-1', title: 'T', start: 's', end: 'e', allDay: false, source: 'reservation', sequence: 0 }), setGuestStatus: async () => false },
			loadCalendarPart: async () => message(),
			timeZone: async () => 'UTC',
			reschedule: async () => 'ok',
			declineProposal: async () => {
				throw new Error('RESEND_API_KEY is not set');
			},
			eventsBetween: async () => []
		});
		assert.equal((await failing.act('u1', 'm1', 'decline-proposal')).type, 'not_sent');
		assert.equal((await service.act('u1', 'm1', 'decline-proposal')).type, 'ok');
	});

	test('a proposal about an older version of the event is not acted on', async () => {
		const { service } = setup({ m1: message({ sequence: 0 }) }, { sequence: 2 });
		assert.equal((await service.inspect('u1', 'm1'))?.outdated, true);
		assert.equal((await service.act('u1', 'm1', 'accept-proposal')).type, 'unsupported');
	});

	test('a reply is shown, and is not something to act on', async () => {
		const { service } = setup({ m1: message({ method: 'REPLY', partstat: 'ACCEPTED' }) });
		const answer = await service.inspect('u1', 'm1');
		assert.equal(answer?.method, 'REPLY');
		assert.equal(answer?.status, 'accepted');
		assert.equal(answer?.proposed, null);
		assert.equal((await service.act('u1', 'm1', 'accept-proposal')).type, 'unsupported');
	});

	test('a reply is recorded against the guest as it arrives', async () => {
		const { service, statuses } = setup({});
		assert.equal(await service.applyArrival('u1', message({ method: 'REPLY', partstat: 'DECLINED' })), 'applied');
		assert.deepEqual(statuses, ['ev-1:guest@gmail.test:declined']);
		assert.equal(await service.applyArrival('u1', message({ method: 'COUNTER' })), 'ignored');
	});

	test('answers about events that are not the user’s are ignored', async () => {
		const { service } = setup({ other: message({ uid: 'abc@google.com' }), gone: message() }, null);
		assert.equal(await service.inspect('u1', 'other'), null);
		assert.equal(await service.inspect('u1', 'gone'), null);
		assert.equal((await service.act('u1', 'gone', 'decline-proposal')).type, 'not_found');
		assert.equal(await service.applyArrival('u1', message({ method: 'REQUEST' })), 'ignored');
	});
});

describe('a real Google Calendar proposal', () => {
	// Verbatim from Gmail's "Proposed new time" email, folded ATTENDEE line and all.
	const google = [
		'BEGIN:VCALENDAR',
		'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
		'VERSION:2.0',
		'CALSCALE:GREGORIAN',
		'METHOD:COUNTER',
		'BEGIN:VEVENT',
		'DTSTART:20260925T043000Z',
		'DTEND:20260925T050000Z',
		'DTSTAMP:20260924T183420Z',
		'ORGANIZER;CN=Muhammad Hibrizi Farghana:mailto:izi@mhibrizif.com',
		'UID:45033627-a786-432e-8fa9-dbd0d1535083@zimail',
		'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Muhamm',
		' ad Hibrizi Farghana;X-NUM-GUESTS=0:mailto:hibrizifarghana@gmail.com',
		'CREATED:20260924T124157Z',
		'DESCRIPTION:',
		'LAST-MODIFIED:20260924T183419Z',
		'LOCATION:',
		'SEQUENCE:0',
		'STATUS:CONFIRMED',
		'SUMMARY:Demo TI with Muhammad Hibrizi Farghana',
		'TRANSP:OPAQUE',
		'END:VEVENT',
		'END:VCALENDAR',
		''
	].join('\r\n');

	test('reads as a new time for the booking, from the guest who proposed it', async () => {
		const { service, moves } = setup(
			{ m1: google },
			{ id: '45033627-a786-432e-8fa9-dbd0d1535083', start: '2026-09-25T03:30:00.000Z', end: '2026-09-25T04:00:00.000Z' }
		);
		const answer = await service.inspect('u1', 'm1');
		assert.equal(answer?.method, 'COUNTER');
		assert.deepEqual(answer?.from, { email: 'hibrizifarghana@gmail.com', name: 'Muhammad Hibrizi Farghana' });
		assert.deepEqual(answer?.proposed, { start: '2026-09-25T04:30:00.000Z', end: '2026-09-25T05:00:00.000Z', allDay: false });
		assert.equal(answer?.comment, null);

		assert.equal((await service.act('u1', 'm1', 'accept-proposal')).type, 'ok');
		assert.deepEqual(moves, ['45033627-a786-432e-8fa9-dbd0d1535083:2026-09-25T04:30:00.000Z']);
	});
});

describe('declineCounterIcs', () => {
	test('names the event as it stands, for the guest who proposed', () => {
		const proposal = readInvitation(message(), 'UTC')!;
		const text = declineCounterIcs(
			proposal,
			{ email: 'me@zimail.test', name: 'Me' },
			{ email: 'guest@gmail.test', name: 'Guest' },
			{ start: new Date('2026-09-24T03:00:00Z'), end: new Date('2026-09-24T03:30:00Z'), sequence: 1 },
			new Date('2026-09-20T00:00:00Z')
		);
		assert.match(text, /METHOD:DECLINECOUNTER/);
		assert.match(text, /UID:ev-1@zimail/);
		assert.match(text, /SEQUENCE:1/);
		assert.match(text, /DTSTART:20260924T030000Z/);
		assert.match(text, /ATTENDEE;CN="Guest":mailto:guest@gmail\.test/);
	});
});
