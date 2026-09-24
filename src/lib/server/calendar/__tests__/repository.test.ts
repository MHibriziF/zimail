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

	test('overlap is start < to and end > from', async () => {
		const { repo, queries } = setup();
		await repo.listOverlapping('user-1', 'FROM', 'TO', 10);
		assert.match(queries[0].sql, /starts_at < \? AND ends_at > \?/);
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
				busy: 0
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
			busy: false
		});
	});
});
