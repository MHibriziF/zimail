import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1ReservationsRepository } from '../repository';

type Query = { sql: string; args: unknown[] };

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { repo: createD1ReservationsRepository(db), queries };
}

describe('ReservationsRepository', () => {
	test('owner queries are scoped to the user', async () => {
		const { repo, queries } = setup();
		await repo.listForUser('user-1');
		await repo.get('user-1', 'p');
		await repo.delete('user-1', 'p');
		for (const query of queries) {
			assert.match(query.sql, /user_id = \?/);
			assert.ok(query.args.includes('user-1'));
		}
	});

	test('a booking writes the reservation and its busy event in one batch', async () => {
		const { repo, queries } = setup();
		await repo.insertBooking({
			id: 'r',
			pageId: 'p',
			userId: 'u',
			eventId: 'e',
			guestName: 'Ana',
			guestEmail: 'ana@example.com',
			note: null,
			start: 's',
			end: 'e2',
			createdAt: 'c',
			eventTitle: 'Ana · Office hours',
			eventNotes: 'Booked by Ana',
			meetingCode: 'abc-defg-hij',
			meetingUrl: 'https://mail.example/meet/abc-defg-hij',
			manageTokenHash: 'hash-1',
			eventLocation: 'https://mail.test/meet/abc-defg-hij',
			collaborators: []
		});
		assert.equal(queries.length, 3);
		assert.match(queries[0].sql, /INSERT INTO reservations/);
		assert.match(queries[1].sql, /INSERT INTO calendar_events .*'reservation'/s);
		assert.match(queries[1].sql, /, 0, \?, \?, 1\)/);
		assert.ok(queries[0].args.includes('abc-defg-hij'));
		assert.ok(queries[1].args.some((arg) => arg === 'https://mail.test/meet/abc-defg-hij'));
	});

	test('a booking also puts its guest on the guest list', async () => {
		const { repo, queries } = setup();
		await repo.insertBooking({
			id: 'r',
			pageId: 'p',
			userId: 'u',
			eventId: 'e',
			guestName: 'Ana',
			guestEmail: 'Ana@Example.com',
			note: null,
			start: 's',
			end: 'e2',
			createdAt: 'c',
			eventTitle: 'Ana · Office hours',
			eventNotes: 'Booked by Ana',
			meetingCode: null,
			meetingUrl: null,
			manageTokenHash: 'hash-2',
			eventLocation: null,
			collaborators: []
		});
		assert.match(queries[2].sql, /INSERT INTO event_guests .*lower\(\?\)/s);
		assert.deepEqual(queries[2].args, ['e', 'u', 'Ana@Example.com', 'Ana']);
	});

	test('a booking puts the page collaborators on the guest list too, in the same batch', async () => {
		const { repo, queries } = setup();
		await repo.insertBooking({
			id: 'r',
			pageId: 'p',
			userId: 'u',
			eventId: 'e',
			guestName: 'Ana',
			guestEmail: 'ana@example.com',
			note: null,
			start: 's',
			end: 'e2',
			createdAt: 'c',
			eventTitle: 'Ana · Office hours',
			eventNotes: 'Booked by Ana',
			meetingCode: null,
			meetingUrl: null,
			manageTokenHash: 'hash-3',
			eventLocation: null,
			collaborators: ['me@other.test', 'kim@example.com']
		});
		assert.equal(queries.length, 5);
		assert.match(queries[3].sql, /INSERT OR IGNORE INTO event_guests/);
		assert.deepEqual(queries[3].args, ['e', 'u', 'me@other.test']);
		assert.deepEqual(queries[4].args, ['e', 'u', 'kim@example.com']);
	});

	test('a booking reads back who else it was sent to, without the guest', async () => {
		const { repo, queries } = setup((query) =>
			query.sql.includes('FROM event_guests')
				? [{ email: 'me@other.test' }]
				: [{ guest_name: 'Ana', guest_email: 'Ana@example.com', starts_at: 's', ends_at: 'e', title: 'T', time_zone: 'UTC', sequence: 0 }]
		);
		const booking = await repo.getBookingByEvent('u', 'e');
		assert.deepEqual(booking?.collaborators, ['me@other.test']);
		const guests = queries.find((query) => query.sql.includes('FROM event_guests'));
		assert.match(guests!.sql, /email <> lower\(\?\)/);
		assert.deepEqual(guests!.args, ['e', 'u', 'Ana@example.com']);
	});

	test('collaborators round-trip through their JSON column, and a page without them reads as none', async () => {
		const { repo, queries } = setup();
		await repo.update('u', 'p', {
			title: 'T',
			description: null,
			location: null,
			slug: 's',
			timeZone: 'UTC',
			startDate: '2026-09-28',
			endDate: '2026-10-09',
			weekdays: [1],
			dayStart: 540,
			dayEnd: 720,
			slotMinutes: 30,
			bufferMinutes: 0,
			noticeMinutes: 0,
			active: true,
			withMeeting: false,
			rescheduleCutoffHours: 24,
			collaborators: ['me@other.test']
		});
		assert.ok(queries[0].args.includes('["me@other.test"]'));
		const read = (collaborators: string | null) =>
			setup(() => [{ id: 'p', user_id: 'u', slug: 's', weekdays: '1', collaborators }]).repo.getBySlug('s');
		assert.deepEqual((await read('["me@other.test"]'))?.collaborators, ['me@other.test']);
		assert.deepEqual((await read(null))?.collaborators, []);
		assert.deepEqual((await read('not json'))?.collaborators, []);
	});

	test('moving a booking moves both rows and bumps the event revision', async () => {
		const { repo, queries } = setup((query) => (query.sql.startsWith('UPDATE calendar_events') ? [{}] : []));
		assert.equal(await repo.moveBooking('u', 'e', 'S', 'E'), true);
		assert.match(queries[0].sql, /UPDATE reservations SET starts_at = \?, ends_at = \?/);
		assert.match(queries[1].sql, /sequence = sequence \+ 1/);
		assert.deepEqual(queries[1].args, ['S', 'E', 'e', 'u']);
		assert.equal(await setup().repo.moveBooking('u', 'missing', 'S', 'E'), false);
	});

	test('a booking reads back with its revision, and its link only when it has a room', async () => {
		const row = {
			guest_name: 'Ana',
			guest_email: 'ana@example.com',
			note: null,
			starts_at: 's',
			ends_at: 'e',
			meeting_code: 'room-1',
			title: 'Office hours',
			time_zone: 'Asia/Jakarta',
			location: 'https://mail.test/meet/room-1',
			sequence: 2
		};
		const booking = await setup(() => [row]).repo.getBookingByEvent('u', 'e');
		assert.equal(booking?.sequence, 2);
		assert.equal(booking?.meetingUrl, 'https://mail.test/meet/room-1');
		const noRoom = await setup(() => [{ ...row, meeting_code: null, location: 'Cafe' }]).repo.getBookingByEvent('u', 'e');
		assert.equal(noRoom?.meetingUrl, null);
	});

	test('weekdays round-trip through their comma list, dropping junk', async () => {
		const { repo } = setup(() => [
			{
				id: 'p',
				user_id: 'u',
				slug: 's',
				title: 'T',
				description: null,
				time_zone: 'UTC',
				start_date: '2026-09-28',
				end_date: '2026-10-09',
				weekdays: '1,3,9,x',
				day_start: 540,
				day_end: 720,
				slot_minutes: 30,
				buffer_minutes: 0,
				notice_minutes: 0,
				active: 0,
				with_meeting: 1
			}
		]);
		const page = await repo.getBySlug('s');
		assert.deepEqual(page?.weekdays, [1, 3]);
		assert.equal(page?.active, false);
		assert.equal(page?.withMeeting, true);
	});
});
