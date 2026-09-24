import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarEvent, ValidEventInput } from '../../../calendar/events';
import type { CalendarRepository, NewCalendarEvent } from '../repository';
import { createCalendarService } from '../service';

type Row = CalendarEvent & { userId: string };

function fakeRepo(seed: Row[] = []) {
	const rows = [...seed];
	const strip = ({ userId: _userId, ...event }: Row): CalendarEvent => event;
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
			if (!row) return false;
			Object.assign(row, input);
			return true;
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
			if (index < 0) return false;
			rows.splice(index, 1);
			return true;
		}
	};
	return { repo, rows };
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
});
