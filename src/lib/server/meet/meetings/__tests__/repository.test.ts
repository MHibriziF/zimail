import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../../__tests__/support/fake-d1';
import { createD1MeetingsRepository } from '../repository';

type Row = {
	id: string;
	user_id: string;
	domain_id: string | null;
	title: string | null;
	code: string | null;
	require_approval: number;
	screen_share_policy: string;
	screen_share_mode: string;
	created_at: string;
};

function row(overrides: Partial<Row> = {}): Row {
	return {
		id: 'meeting-1',
		user_id: 'user-1',
		domain_id: null,
		title: 'Standup',
		code: 'aaa-aaaa-aaa',
		require_approval: 0,
		screen_share_policy: 'open',
		screen_share_mode: 'multiple',
		created_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

/** Enforces the same partial-unique(code) constraint the real migration does. */
function setup(seed: Row[] = []) {
	const rows = seed.map((entry) => ({ ...entry }));

	function assertCodeFree(code: string | null, exceptId?: string) {
		if (code && rows.some((entry) => entry.code === code && entry.id !== exceptId)) {
			throw new Error('UNIQUE constraint failed: meetings.code');
		}
	}

	const db = createFakeD1(({ sql, args }) => {
		if (sql.includes('COUNT(*)')) {
			const userId = String(args[0]);
			return [{ count: rows.filter((entry) => entry.user_id === userId).length }];
		}
		if (sql.startsWith('INSERT INTO meetings')) {
			const [id, userId, domainId, title, code, requireApproval, createdAt] = args as [
				string,
				string,
				string | null,
				string | null,
				string,
				number,
				string
			];
			assertCodeFree(code);
			rows.push({ id, user_id: userId, domain_id: domainId, title, code, require_approval: requireApproval, screen_share_policy: 'open', screen_share_mode: 'multiple', created_at: createdAt });
			return [];
		}
		if (sql.includes('WHERE code = ?')) {
			return rows.filter((entry) => entry.code === args[0]);
		}
		if (sql.includes('WHERE user_id = ?') && sql.startsWith('SELECT')) {
			return rows
				.filter((entry) => entry.user_id === args[0])
				.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
		}
		if (sql.includes('WHERE id = ? AND user_id = ?') && sql.startsWith('SELECT')) {
			const [id, userId] = args as [string, string];
			return rows.filter((entry) => entry.id === id && entry.user_id === userId);
		}
		if (sql.startsWith('UPDATE meetings SET code')) {
			const [code, id, userId] = args as [string, string, string];
			const entry = rows.find((e) => e.id === id && e.user_id === userId);
			if (!entry) return [];
			assertCodeFree(code, id);
			entry.code = code;
			return [entry];
		}
		if (sql.startsWith('UPDATE meetings SET')) {
			const id = String(args[args.length - 2]);
			const userId = String(args[args.length - 1]);
			const entry = rows.find((e) => e.id === id && e.user_id === userId);
			if (!entry) return [];
			let cursor = 0;
			if (sql.includes('title = ?')) entry.title = args[cursor++] as string | null;
			if (sql.includes('require_approval = ?')) entry.require_approval = args[cursor++] as number;
			if (sql.includes('screen_share_policy = ?')) entry.screen_share_policy = args[cursor++] as string;
			if (sql.includes('screen_share_mode = ?')) entry.screen_share_mode = args[cursor++] as string;
			return [entry];
		}
		throw new Error(`Unhandled query in fake D1: ${sql}`);
	});

	return { repo: createD1MeetingsRepository(db), rows };
}

describe('MeetingsRepository', () => {
	test('countForUser only counts that user\'s rows', async () => {
		const { repo } = setup([row({ id: 'a', user_id: 'user-1' }), row({ id: 'b', user_id: 'user-2' })]);
		assert.equal(await repo.countForUser('user-1'), 1);
		assert.equal(await repo.countForUser('nobody'), 0);
	});

	test('insert then findByCode round-trips, and rejects a duplicate code', async () => {
		const { repo } = setup();
		await repo.insert({ id: 'a', userId: 'user-1', domainId: null, title: 'Standup', code: 'aaa-aaaa-aaa', requireApproval: false, createdAt: '2026-01-01' });

		assert.equal((await repo.findByCode('aaa-aaaa-aaa'))?.id, 'a');
		assert.equal(await repo.findByCode('missing'), null);

		await assert.rejects(
			repo.insert({ id: 'b', userId: 'user-1', domainId: null, title: 'Other', code: 'aaa-aaaa-aaa', requireApproval: false, createdAt: '2026-01-01' }),
			/unique constraint/i
		);
	});

	test('listForUser only returns the requesting user\'s own rows', async () => {
		const { repo } = setup([row({ id: 'a', user_id: 'user-1' }), row({ id: 'b', user_id: 'user-2' })]);
		assert.deepEqual(
			(await repo.listForUser('user-1')).map((m) => m.id),
			['a']
		);
	});

	test('getForUser is ownership-scoped', async () => {
		const { repo } = setup([row()]);
		assert.equal((await repo.getForUser('user-1', 'meeting-1'))?.title, 'Standup');
		assert.equal(await repo.getForUser('someone-else', 'meeting-1'), null);
	});

	test('updateFields only applies the given fields, ownership-checked', async () => {
		const { repo, rows } = setup([row()]);
		assert.equal(await repo.updateFields('user-1', 'meeting-1', { requireApproval: true }), true);
		assert.equal(rows[0].require_approval, 1);
		assert.equal(rows[0].title, 'Standup');

		assert.equal(await repo.updateFields('someone-else', 'meeting-1', { title: 'Hijacked' }), false);
		assert.equal(rows[0].title, 'Standup');
	});

	test('screen-share settings round-trip, and an unknown stored value reads as the default', async () => {
		const { repo, rows } = setup([row()]);
		assert.equal(
			await repo.updateFields('user-1', 'meeting-1', { screenSharePolicy: 'approval', screenShareMode: 'single' }),
			true
		);
		assert.equal(rows[0].screen_share_policy, 'approval');
		assert.equal(rows[0].screen_share_mode, 'single');

		const meeting = await repo.getForUser('user-1', 'meeting-1');
		assert.equal(meeting?.screen_share_policy, 'approval');
		assert.equal(meeting?.screen_share_mode, 'single');

		rows[0].screen_share_policy = 'something-else';
		assert.equal((await repo.getForUser('user-1', 'meeting-1'))?.screen_share_policy, 'open');
	});

	test('updateCode replaces the code, ownership-checked, and rejects a collision', async () => {
		const { repo, rows } = setup([row({ id: 'a', code: 'aaa-aaaa-aaa' }), row({ id: 'b', user_id: 'user-1', code: 'bbb-bbbb-bbb' })]);
		assert.equal(await repo.updateCode('user-1', 'b', 'ccc-cccc-ccc'), true);
		assert.equal(rows.find((r) => r.id === 'b')?.code, 'ccc-cccc-ccc');

		assert.equal(await repo.updateCode('someone-else', 'b', 'ddd-dddd-ddd'), false);
		await assert.rejects(repo.updateCode('user-1', 'b', 'aaa-aaaa-aaa'), /unique constraint/i);
	});
});
