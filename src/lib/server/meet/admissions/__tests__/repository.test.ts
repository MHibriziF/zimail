import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../../__tests__/support/fake-d1';
import { createD1AdmissionsRepository } from '../repository';

type Row = { id: string; meeting_id: string; name: string; status: string; created_at: string };

function setup(seed: Row[] = []) {
	const rows = seed.map((row) => ({ ...row }));
	let clock = 0;

	const db = createFakeD1(({ sql, args }) => {
		if (sql.startsWith('INSERT INTO meeting_admissions')) {
			const [id, meetingId, name] = args as [string, string, string];
			clock += 1;
			rows.push({ id, meeting_id: meetingId, name, status: 'pending', created_at: `t${clock}` });
			return [];
		}
		if (sql.startsWith('UPDATE meeting_admissions SET status')) {
			const [status, id, meetingId, ...from] = args as [string, string, string, ...string[]];
			const row = rows.find((entry) => entry.id === id && entry.meeting_id === meetingId && from.includes(entry.status));
			if (row) row.status = status;
			return row ? [row] : [];
		}
		if (sql.startsWith('SELECT status FROM meeting_admissions')) {
			const [id, meetingId] = args as [string, string];
			const row = rows.find((entry) => entry.id === id && entry.meeting_id === meetingId);
			return row ? [{ status: row.status }] : [];
		}
		if (sql.includes("status = 'pending'")) {
			const meetingId = String(args[0]);
			return rows
				.filter((row) => row.meeting_id === meetingId && row.status === 'pending')
				.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
				.map((row) => ({ id: row.id, name: row.name, created_at: row.created_at }));
		}
		throw new Error(`Unhandled query in fake D1: ${sql}`);
	});

	return { repo: createD1AdmissionsRepository(db), rows };
}

describe('AdmissionsRepository', () => {
	test('a new request starts pending and is found by meeting + id', async () => {
		const { repo } = setup();
		const admission = await repo.create('meeting-1', 'Ada');
		assert.equal((await repo.get('meeting-1', admission.id))?.status, 'pending');
	});

	test('an admission from a different meeting is not found (scoped)', async () => {
		const { repo } = setup();
		const admission = await repo.create('meeting-1', 'Ada');
		assert.equal(await repo.get('meeting-2', admission.id), null);
	});

	test('an empty name falls back to "Guest"', async () => {
		const { repo, rows } = setup();
		await repo.create('meeting-1', '   ');
		assert.equal(rows[0].name, 'Guest');
	});

	test('listPending only returns pending rows for that meeting, oldest first', async () => {
		const { repo } = setup();
		const first = await repo.create('meeting-1', 'Ada');
		const second = await repo.create('meeting-1', 'Grace');
		await repo.create('meeting-2', 'Someone else');
		await repo.setStatus('meeting-1', first.id, 'admitted');

		const pending = await repo.listPending('meeting-1');
		assert.deepEqual(
			pending.map((admission) => admission.id),
			[second.id]
		);
	});

	test('setStatus is scoped to the meeting and reports whether it found a row', async () => {
		const { repo } = setup();
		const admission = await repo.create('meeting-1', 'Ada');

		assert.equal(await repo.setStatus('meeting-2', admission.id, 'denied'), false);
		assert.equal((await repo.get('meeting-1', admission.id))?.status, 'pending');

		assert.equal(await repo.setStatus('meeting-1', admission.id, 'denied'), true);
		assert.equal((await repo.get('meeting-1', admission.id))?.status, 'denied');
	});

	test('a decision is final', async () => {
		const { repo } = setup();
		const admission = await repo.create('meeting-1', 'Ada');
		await repo.setStatus('meeting-1', admission.id, 'denied');

		assert.equal(await repo.setStatus('meeting-1', admission.id, 'admitted'), false);
		assert.equal(await repo.setStatus('meeting-1', admission.id, 'joined'), false);
		assert.equal((await repo.get('meeting-1', admission.id))?.status, 'denied');
	});

	test('an admission is joined once', async () => {
		const { repo } = setup();
		const admission = await repo.create('meeting-1', 'Ada');
		assert.equal(await repo.setStatus('meeting-1', admission.id, 'joined'), false);

		await repo.setStatus('meeting-1', admission.id, 'admitted');
		assert.equal(await repo.setStatus('meeting-1', admission.id, 'joined'), true);
		assert.equal(await repo.setStatus('meeting-1', admission.id, 'joined'), false);
	});
});
