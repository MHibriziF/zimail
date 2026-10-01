import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiHistoryRepository, ConversationRow } from '../repository';
import { createAiHistoryService, MAX_CONVERSATIONS, MAX_TURNS, parseTurns, titleFor, toHistory, type StoredTurn } from '../service';

function memoryRepo() {
	const rows = new Map<string, ConversationRow & { userId: string }>();
	const calls: string[] = [];
	const repo: AiHistoryRepository = {
		async list(userId) {
			return [...rows.values()].filter((row) => row.userId === userId).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
		},
		async get(userId, id) {
			const row = rows.get(id);
			return row && row.userId === userId ? row : null;
		},
		async insert(row) {
			calls.push('insert');
			rows.set(row.id, { ...row, updatedAt: 'now' });
		},
		async updateTurns(userId, id, turns) {
			calls.push('update');
			const row = rows.get(id);
			if (!row || row.userId !== userId) return false;
			row.turns = turns;
			return true;
		},
		async delete(userId, id) {
			return rows.get(id)?.userId === userId && rows.delete(id);
		},
		async trim(_userId, keep) {
			calls.push(`trim:${keep}`);
		}
	};
	return { repo, rows, calls };
}

const answer = { content: 'Tuesday at 7pm.', messages: [], events: [] };

test('a first question starts a conversation named after it', async () => {
	const { repo, rows, calls } = memoryRepo();
	const svc = createAiHistoryService({ repo, newId: () => 'c1' });
	const id = await svc.append('u1', null, '  when is   dinner with Ana? ', answer);
	assert.equal(id, 'c1');
	assert.equal(rows.get('c1')?.title, 'when is dinner with Ana?');
	assert.deepEqual(calls, ['insert', `trim:${MAX_CONVERSATIONS}`]);
	const turns = parseTurns(rows.get('c1')!.turns);
	assert.deepEqual(toHistory(turns), [
		{ role: 'user', content: '  when is   dinner with Ana? ' },
		{ role: 'assistant', content: 'Tuesday at 7pm.' }
	]);
});

test('a follow-up is one update to the same row, keeping only the newest turns', async () => {
	const { repo, rows, calls } = memoryRepo();
	const svc = createAiHistoryService({ repo, newId: () => 'c1' });
	await svc.append('u1', null, 'first', answer);
	calls.length = 0;
	const long: StoredTurn[] = Array.from({ length: MAX_TURNS }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` }));
	rows.get('c1')!.turns = JSON.stringify(long);
	const conversation = await svc.get('u1', 'c1');
	assert.equal(await svc.append('u1', conversation, 'next', answer), 'c1');
	assert.deepEqual(calls, ['update']);
	const turns = parseTurns(rows.get('c1')!.turns);
	assert.equal(turns.length, MAX_TURNS);
	assert.equal(turns.at(-2)?.content, 'next');
	assert.equal(turns[0].content, 't2');
});

test('a conversation deleted in another tab starts a new one rather than failing', async () => {
	const { repo } = memoryRepo();
	let n = 0;
	const svc = createAiHistoryService({ repo, newId: () => `c${++n}` });
	await svc.append('u1', null, 'first', answer);
	const conversation = await svc.get('u1', 'c1');
	await svc.remove('u1', 'c1');
	assert.equal(await svc.append('u1', conversation, 'again', answer), 'c2');
});

test("someone else's conversation can't be read, continued or deleted", async () => {
	const { repo, rows } = memoryRepo();
	const svc = createAiHistoryService({ repo, newId: () => 'c1' });
	await svc.append('u1', null, 'mine', answer);
	assert.equal(await svc.get('u2', 'c1'), null);
	assert.equal(await svc.remove('u2', 'c1'), false);
	assert.ok(rows.has('c1'));
});

test('titles are cut short, and damaged rows read as empty', () => {
	assert.equal(titleFor('x'.repeat(100)).length, 80);
	assert.ok(titleFor('x'.repeat(100)).endsWith('…'));
	assert.deepEqual(parseTurns('{not json'), []);
	assert.deepEqual(parseTurns('[{"role":"user","content":"ok"},{"role":"system","content":"x"},null]'), [{ role: 'user', content: 'ok' }]);
});
