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
			eventNotes: 'Booked by Ana'
		});
		assert.equal(queries.length, 2);
		assert.match(queries[0].sql, /INSERT INTO reservations/);
		assert.match(queries[1].sql, /INSERT INTO calendar_events .*'reservation'/s);
		assert.match(queries[1].sql, /, 0, \?, 1\)/);
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
				active: 0
			}
		]);
		const page = await repo.getBySlug('s');
		assert.deepEqual(page?.weekdays, [1, 3]);
		assert.equal(page?.active, false);
	});
});
