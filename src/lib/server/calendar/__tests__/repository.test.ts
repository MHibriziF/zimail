import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1CalendarRepository } from '../repository';

type Query = { sql: string; args: unknown[] };

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { repo: createD1CalendarRepository(db), queries };
}

const valid = {
	title: 'Standup',
	start: '2026-09-24T02:00:00.000Z',
	end: '2026-09-24T02:15:00.000Z',
	allDay: false,
	location: null,
	notes: null
};

describe('CalendarRepository', () => {
	test('every query is scoped to the user', async () => {
		const { repo, queries } = setup();
		await repo.listOverlapping('user-1', 'a', 'b', 10);
		await repo.get('user-1', 'e1');
		await repo.updateManual('user-1', 'e1', valid);
		await repo.deleteManual('user-1', 'e1');
		for (const query of queries) {
			assert.match(query.sql, /user_id = \?/);
			assert.ok(query.args.includes('user-1'));
		}
	});

	test('updates and deletes only touch manual rows', async () => {
		const { repo, queries } = setup();
		await repo.updateManual('user-1', 'e1', valid);
		await repo.deleteManual('user-1', 'e1');
		for (const query of queries) assert.match(query.sql, /source = 'manual'/);
	});

	test('taking an invitation off removes every occurrence of its series', async () => {
		const { repo, queries } = setup(() => [{}, {}, {}]);
		assert.equal(await repo.deleteInvite('user-1', 'e1'), true);
		assert.match(queries[0].sql, /source = 'invite' AND source_id = \(\s*SELECT source_id/);
		assert.deepEqual(queries[0].args, ['user-1', 'e1', 'user-1']);
		assert.equal(await setup().repo.deleteInvite('user-1', 'nope'), false);
	});

	test('overlap is start < to and end > from', async () => {
		const { repo, queries } = setup();
		await repo.listOverlapping('user-1', 'FROM', 'TO', 10);
		assert.match(queries[0].sql, /e\.starts_at < \? AND e\.ends_at > \?/);
		assert.deepEqual(queries[0].args, ['user-1', 'TO', 'FROM', 10]);
	});

	test('rows map to events, with unknown sources read as manual', async () => {
		const { repo } = setup(() => [
			{
				id: 'e1',
				title: 'X',
				starts_at: valid.start,
				ends_at: valid.end,
				all_day: 1,
				location: null,
				notes: 'n',
				source: 'mystery',
				busy: 0,
				feed_name: null,
				feed_color: null
			}
		]);
		assert.deepEqual(await repo.get('user-1', 'e1'), {
			id: 'e1',
			title: 'X',
			start: valid.start,
			end: valid.end,
			allDay: true,
			location: null,
			notes: 'n',
			source: 'manual',
			busy: false,
			calendar: null
		});
	});

	test('a feed event carries its calendar, with an unknown color read as blue', async () => {
		const { repo } = setup(() => [
			{
				id: 'e1',
				title: 'X',
				starts_at: valid.start,
				ends_at: valid.end,
				all_day: 0,
				location: null,
				notes: null,
				source: 'feed',
				busy: 1,
				feed_name: 'Work',
				feed_color: 'plaid'
			}
		]);
		assert.deepEqual((await repo.get('user-1', 'e1'))?.calendar, { name: 'Work', color: 'blue' });
	});

	test('an edit or a delete reports the revision, or null when nothing matched', async () => {
		const { repo, queries } = setup(() => [{ sequence: 4 }]);
		assert.equal(await repo.updateManual('user-1', 'e1', valid), 4);
		assert.match(queries[0].sql, /sequence = sequence \+ 1/);
		assert.match(queries[0].sql, /RETURNING sequence/);
		assert.equal(await repo.deleteManual('user-1', 'e1'), 4);
		assert.match(queries[1].sql, /RETURNING sequence/);
		assert.equal(await setup().repo.updateManual('user-1', 'e1', valid), null);
		assert.equal(await setup().repo.deleteManual('user-1', 'e1'), null);
	});

	test('guests are listed for the user, with an unknown answer read as needs-action', async () => {
		const { repo, queries } = setup(() => [
			{ email: 'ada@example.com', name: 'Ada', status: 'accepted' },
			{ email: 'bo@example.com', name: null, status: 'shrug' }
		]);
		assert.deepEqual(await repo.listGuests('user-1', 'e1'), [
			{ email: 'ada@example.com', name: 'Ada', status: 'accepted' },
			{ email: 'bo@example.com', name: null, status: 'needs-action' }
		]);
		assert.deepEqual(queries[0].args, ['e1', 'user-1']);
	});

	test('setting guests drops the missing, adds the new, and resets answers only when asked', async () => {
		const { repo, queries } = setup();
		await repo.setGuests('user-1', 'e1', ['ada@example.com', 'bo@example.com'], false);
		assert.match(queries[0].sql, /DELETE FROM event_guests[\s\S]*NOT IN \(SELECT value FROM json_each\(\?\)\)/);
		assert.deepEqual(queries[0].args, ['e1', 'user-1', '["ada@example.com","bo@example.com"]']);
		assert.deepEqual(
			queries.slice(1).map((query) => query.args),
			[
				['e1', 'user-1', 'ada@example.com'],
				['e1', 'user-1', 'bo@example.com']
			]
		);
		assert.ok(queries.slice(1).every((query) => query.sql.startsWith('INSERT OR IGNORE')));

		const reset = setup();
		await reset.repo.setGuests('user-1', 'e1', [], true);
		assert.equal(reset.queries.length, 2);
		assert.match(reset.queries[1].sql, /SET status = 'needs-action'/);
	});
});
