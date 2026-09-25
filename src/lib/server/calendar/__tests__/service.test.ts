import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarEvent, EventGuest, ValidEventInput } from '../../../calendar/events';
import type { CalendarRepository, NewCalendarEvent } from '../repository';
import { createCalendarService, type GuestMail } from '../service';

type Row = CalendarEvent & { userId: string; sequence?: number };

function fakeRepo(seed: Row[] = [], seedGuests: Record<string, EventGuest[]> = {}) {
	const rows = structuredClone(seed);
	const guests: Record<string, EventGuest[]> = structuredClone(seedGuests);
	const strip = ({ userId: _userId, sequence: _sequence, ...event }: Row): CalendarEvent => event;
	const repo: CalendarRepository = {
		async listOverlapping(userId, from, to) {
			return rows.filter((row) => row.userId === userId && row.start < to && row.end > from).map(strip);
		},
		async get(userId, id) {
			const row = rows.find((entry) => entry.userId === userId && entry.id === id);
			return row ? strip(row) : null;
		},
		async insert(event: NewCalendarEvent) {
			rows.push({
				id: event.id,
				userId: event.userId,
				title: event.title,
				start: event.start,
				end: event.end,
				allDay: event.allDay,
				location: event.location,
				notes: event.notes,
				source: event.source,
				busy: event.busy !== false,
				calendar: null
			});
		},
		async updateManual(userId, id, input: ValidEventInput) {
			const row = rows.find((entry) => entry.userId === userId && entry.id === id && entry.source === 'manual');
			if (!row) return null;
			Object.assign(row, input);
			row.sequence = (row.sequence ?? 0) + 1;
			return row.sequence;
		},
		async deleteReservation(userId, id) {
			const index = rows.findIndex(
				(entry) => entry.userId === userId && entry.id === id && entry.source === 'reservation'
			);
			if (index < 0) return false;
			rows.splice(index, 1);
			return true;
		},
		async deleteManual(userId, id) {
			const index = rows.findIndex((entry) => entry.userId === userId && entry.id === id && entry.source === 'manual');
			if (index < 0) return null;
			const [row] = rows.splice(index, 1);
			delete guests[id];
			return row.sequence ?? 0;
		},
		async listGuests(_userId, eventId) {
			return structuredClone(guests[eventId] ?? []);
		},
		async setGuests(_userId, eventId, emails, resetAnswers) {
			const current = guests[eventId] ?? [];
			guests[eventId] = emails.map((email) => {
				const kept = current.find((guest) => guest.email === email);
				if (!kept) return { email, name: null, status: 'needs-action' };
				return resetAnswers ? { ...kept, status: 'needs-action' } : kept;
			});
		},
		async deleteInvite(userId, id) {
			const index = rows.findIndex((entry) => entry.userId === userId && entry.id === id && entry.source === 'invite');
			if (index < 0) return false;
			rows.splice(index, 1);
			return true;
		}
	};
	return { repo, rows, guests };
}

function mailbox() {
	const sent: GuestMail[] = [];
	const notifyGuests = async (_userId: string, mail: GuestMail) => {
		sent.push(mail);
	};
	const summary = () => sent.map((mail) => `${mail.notice}:${mail.to.join(',')}@${mail.event.sequence}`).sort();
	return { sent, notifyGuests, summary };
}

const feedRow: Row = {
	id: 'feed-1',
	userId: 'u1',
	title: 'From Google',
	start: '2026-09-24T02:00:00.000Z',
	end: '2026-09-24T03:00:00.000Z',
	allDay: false,
	location: null,
	notes: null,
	source: 'feed',
	busy: true,
	calendar: { name: 'Google', color: 'blue' }
};

const input = { title: 'Standup', start: '2026-09-24T02:00:00.000Z', end: '2026-09-24T02:15:00.000Z', allDay: false };

describe('CalendarService', () => {
	test('create validates and stores a manual event', async () => {
		const { repo, rows } = fakeRepo();
		const service = createCalendarService({ repo });
		assert.deepEqual(await service.create('u1', { ...input, title: '' }), { type: 'invalid_title' });
		const outcome = await service.create('u1', input);
		assert.equal(outcome.type, 'ok');
		assert.equal(rows.length, 1);
		assert.equal(rows[0].source, 'manual');
	});

	test('feed events are read-only', async () => {
		const service = createCalendarService({ repo: fakeRepo([feedRow]).repo });
		assert.deepEqual(await service.update('u1', 'feed-1', input), { type: 'read_only' });
		assert.equal(await service.remove('u1', 'feed-1'), 'read_only');
	});

	test('a booking is cancelled through the reservations hook when one is wired', async () => {
		const { repo, rows } = fakeRepo([{ ...feedRow, id: 'booking', source: 'reservation', calendar: null }]);
		const cancelled: string[] = [];
		const service = createCalendarService({
			repo,
			cancelReservation: async (_userId, id) => {
				cancelled.push(id);
				return true;
			}
		});
		assert.equal(await service.remove('u1', 'booking'), 'ok');
		assert.deepEqual(cancelled, ['booking']);
		assert.equal(rows.length, 1, 'the hook, not the plain delete, did the work');
	});

	test('a booking can be cancelled but not edited', async () => {
		const { repo, rows } = fakeRepo([{ ...feedRow, id: 'booking', source: 'reservation', calendar: null }]);
		const service = createCalendarService({ repo });
		assert.deepEqual(await service.update('u1', 'booking', input), { type: 'read_only' });
		assert.equal(await service.remove('u1', 'booking'), 'ok');
		assert.equal(rows.length, 0);
	});

	test('another user’s event is not found', async () => {
		const service = createCalendarService({ repo: fakeRepo([{ ...feedRow, source: 'manual' }]).repo });
		assert.deepEqual(await service.update('u2', 'feed-1', input), { type: 'not_found' });
		assert.equal(await service.remove('u2', 'feed-1'), 'not_found');
	});

	test('update replaces the fields and keeps the source', async () => {
		const service = createCalendarService({ repo: fakeRepo([{ ...feedRow, source: 'manual' }]).repo });
		const outcome = await service.update('u1', 'feed-1', { ...input, title: 'Renamed' });
		assert.equal(outcome.type, 'ok');
		if (outcome.type === 'ok') {
			assert.equal(outcome.event.title, 'Renamed');
			assert.equal(outcome.event.source, 'manual');
		}
	});

	test('listBetween rejects empty and oversized ranges', async () => {
		const service = createCalendarService({ repo: fakeRepo().repo });
		const from = new Date('2026-09-01T00:00:00.000Z');
		assert.deepEqual(await service.listBetween('u1', from, from, 'UTC'), { type: 'invalid_range' });
		assert.deepEqual(await service.listBetween('u1', from, new Date('2027-09-01T00:00:00.000Z'), 'UTC'), {
			type: 'invalid_range'
		});
		assert.deepEqual(await service.listBetween('u1', from, new Date('invalid'), 'UTC'), { type: 'invalid_range' });
	});

	test('listBetween judges all-day events by the viewer’s zone', async () => {
		const allDay: Row = {
			...feedRow,
			id: 'all',
			allDay: true,
			start: '2026-09-25T00:00:00.000Z',
			end: '2026-09-26T00:00:00.000Z'
		};
		const service = createCalendarService({ repo: fakeRepo([allDay]).repo });
		// 24 Sept in Jakarta ends at 17:00Z — before the 25th starts there.
		const from = new Date('2026-09-23T17:00:00.000Z');
		const to = new Date('2026-09-24T17:00:00.000Z');
		const jakarta = await service.listBetween('u1', from, to, 'Asia/Jakarta');
		assert.deepEqual(jakarta.type === 'ok' && jakarta.events.map((event) => event.id), []);
		const next = await service.listBetween('u1', to, new Date('2026-09-25T17:00:00.000Z'), 'Asia/Jakarta');
		assert.deepEqual(next.type === 'ok' && next.events.map((event) => event.id), ['all']);
	});

	test('create invites every guest, deduplicated and lowercased', async () => {
		const { repo, guests } = fakeRepo();
		const { notifyGuests, sent, summary } = mailbox();
		const service = createCalendarService({ repo, notifyGuests });
		const outcome = await service.create('u1', { ...input, guests: ['Ada@Example.com', 'ada@example.com', 'bo@example.com'] });
		assert.equal(outcome.type, 'ok');
		if (outcome.type !== 'ok') return;
		assert.deepEqual(
			guests[outcome.event.id].map((guest) => guest.email),
			['ada@example.com', 'bo@example.com']
		);
		assert.deepEqual(summary(), ['new:ada@example.com,bo@example.com@0']);
		assert.equal(sent[0].attendees.length, 2);
	});

	test('a bad or oversized guest list is refused before anything is stored', async () => {
		const { repo, rows } = fakeRepo();
		const service = createCalendarService({ repo });
		assert.deepEqual(await service.create('u1', { ...input, guests: ['not an address'] }), { type: 'invalid_guests' });
		const many = Array.from({ length: 31 }, (_, index) => `g${index}@example.com`);
		assert.deepEqual(await service.create('u1', { ...input, guests: many }), { type: 'invalid_guests' });
		assert.equal(rows.length, 0);
	});

	test('no guests, no email', async () => {
		const { notifyGuests, sent } = mailbox();
		const service = createCalendarService({ repo: fakeRepo().repo, notifyGuests });
		await service.create('u1', input);
		assert.equal(sent.length, 0);
	});

	const manual: Row = { ...feedRow, id: 'm1', source: 'manual', calendar: null, sequence: 2 };
	const invited = (status: EventGuest['status'] = 'accepted'): Record<string, EventGuest[]> => ({
		m1: [
			{ email: 'ada@example.com', name: 'Ada', status },
			{ email: 'bo@example.com', name: null, status }
		]
	});
	const same = { ...input, title: manual.title, start: manual.start, end: manual.end };

	test('an edit tells the kept guests, invites the new and cancels the dropped', async () => {
		const { repo, guests } = fakeRepo([manual], invited());
		const { notifyGuests, sent, summary } = mailbox();
		const service = createCalendarService({ repo, notifyGuests });
		const outcome = await service.update('u1', 'm1', {
			...same,
			title: 'Renamed',
			guests: ['ada@example.com', 'cy@example.com']
		});
		assert.equal(outcome.type, 'ok');
		assert.deepEqual(summary(), ['cancelled:bo@example.com@3', 'new:cy@example.com@3', 'updated:ada@example.com@3']);
		const cancel = sent.find((mail) => mail.notice === 'cancelled');
		assert.deepEqual(cancel?.attendees.map((guest) => guest.email), ['bo@example.com']);
		assert.equal(guests.m1[0].status, 'accepted', 'a new title keeps the answers');
	});

	test('saving without a change only reaches newly added guests', async () => {
		const { repo } = fakeRepo([manual], invited());
		const { notifyGuests, summary } = mailbox();
		const service = createCalendarService({ repo, notifyGuests });
		await service.update('u1', 'm1', { ...same, guests: ['ada@example.com', 'bo@example.com'] });
		assert.deepEqual(summary(), []);
		await service.update('u1', 'm1', { ...same, guests: ['ada@example.com', 'bo@example.com', 'cy@example.com'] });
		assert.deepEqual(summary(), ['new:cy@example.com@4']);
	});

	test('a new time asks everyone again, even when the guest list is left out', async () => {
		const { repo, guests } = fakeRepo([manual], invited());
		const { notifyGuests, summary } = mailbox();
		const service = createCalendarService({ repo, notifyGuests });
		await service.update('u1', 'm1', { ...same, start: '2026-09-24T05:00:00.000Z', end: '2026-09-24T06:00:00.000Z' });
		assert.deepEqual(summary(), ['updated:ada@example.com,bo@example.com@3']);
		assert.deepEqual(
			guests.m1.map((guest) => guest.status),
			['needs-action', 'needs-action']
		);
	});

	test('deleting an event cancels it for every guest at the next revision', async () => {
		const { repo, rows } = fakeRepo([manual], invited());
		const { notifyGuests, sent, summary } = mailbox();
		const service = createCalendarService({ repo, notifyGuests });
		assert.equal(await service.remove('u1', 'm1'), 'ok');
		assert.equal(rows.length, 0);
		assert.deepEqual(summary(), ['cancelled:ada@example.com,bo@example.com@3']);
		assert.equal(sent[0].event.title, manual.title);
	});

	test('a failed email never undoes the change, even one that throws before sending', async () => {
		const { repo, rows } = fakeRepo([manual], invited());
		const service = createCalendarService({
			repo,
			notifyGuests: async () => {
				throw new Error('provider down');
			}
		});
		const unconfigured = createCalendarService({
			repo,
			notifyGuests: () => {
				throw new Error('RESEND_API_KEY is not set');
			}
		});
		const quiet = console.error;
		console.error = () => undefined;
		try {
			assert.equal((await unconfigured.create('u1', { ...input, guests: ['ada@example.com'] })).type, 'ok');
			assert.equal(await service.remove('u1', 'm1'), 'ok');
		} finally {
			console.error = quiet;
		}
		assert.equal(rows.length, 1);
		assert.equal(rows[0].source, 'manual');
		assert.notEqual(rows[0].id, 'm1');
	});

	test('reschedule moves a manual event and tells the guests; other events are not found', async () => {
		const { repo, rows } = fakeRepo([manual, { ...feedRow, id: 'booking', source: 'reservation' }], invited());
		const { notifyGuests, summary } = mailbox();
		const service = createCalendarService({ repo, notifyGuests });
		const start = new Date('2026-09-25T02:00:00.000Z');
		const end = new Date('2026-09-25T03:00:00.000Z');
		assert.equal(await service.reschedule('u1', 'm1', start, end), 'ok');
		assert.equal(rows[0].start, start.toISOString());
		assert.equal(rows[0].title, manual.title);
		assert.deepEqual(summary(), ['updated:ada@example.com,bo@example.com@3']);
		assert.equal(await service.reschedule('u1', 'booking', start, end), 'not_found');
		assert.equal(await service.reschedule('u1', 'missing', start, end), 'not_found');
	});

	test('get returns the guest list with a manual event only', async () => {
		const service = createCalendarService({ repo: fakeRepo([manual, feedRow], invited()).repo });
		assert.equal((await service.get('u1', 'm1'))?.guests.length, 2);
		assert.deepEqual((await service.get('u1', 'feed-1'))?.guests, []);
		assert.equal(await service.get('u1', 'missing'), null);
	});
});
