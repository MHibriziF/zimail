import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeD1 } from './support/fake-d1';
import { DEFAULT_CLEANUP_SETTINGS, runDueCleanup, saveCleanupSettings } from '../cleanup';

type Settings = { trash_retention_days: number; sweep_auto: number; sweep_days: number; sweep_only_read: number; sweep_keep_starred: number };

/** A user row plus a record of every statement, answering just the shapes cleanup sends. */
function fakeDb(settings: Settings, { due = true } = {}) {
	const statements: string[] = [];
	const db = createFakeD1(({ sql }) => {
		const kind = sql.trim().split(/\s+/).slice(0, 3).join(' ');
		statements.push(kind);
		if (sql.includes('SET last_trash_purge_at')) {
			const turnedOn = settings.trash_retention_days > 0 || settings.sweep_auto === 1;
			return due && turnedOn ? [{}] : [];
		}
		if (sql.startsWith('SELECT trash_retention_days')) return [settings];
		if (sql.includes('SET deleted_at')) return [{}, {}];
		return [];
	});
	return { db, statements };
}

const off: Settings = { trash_retention_days: 0, sweep_auto: 0, sweep_days: 90, sweep_only_read: 1, sweep_keep_starred: 1 };

test('with nothing switched on, the daily run claims nothing and moves nothing', async () => {
	const { db, statements } = fakeDb(off);
	assert.deepEqual(await runDueCleanup(db, undefined, 'u1'), { moved: 0, removed: 0 });
	assert.equal(statements.length, 1, 'only the claim, which matches no row');
});

test('the saved sweep runs by itself once switched on', async () => {
	const { db, statements } = fakeDb({ ...off, sweep_auto: 1 });
	assert.deepEqual(await runDueCleanup(db, undefined, 'u1'), { moved: 2, removed: 0 });
	assert.ok(statements.some((s) => s.startsWith('UPDATE emails SET')));
});

test('a run already done today does nothing, even with the sweep on', async () => {
	const { db, statements } = fakeDb({ ...off, sweep_auto: 1 }, { due: false });
	assert.deepEqual(await runDueCleanup(db, undefined, 'u1'), { moved: 0, removed: 0 });
	assert.equal(statements.length, 1);
});

test('only the offered periods can be saved', async () => {
	const { db } = fakeDb(off);
	await assert.rejects(saveCleanupSettings(db, 'u1', { ...DEFAULT_CLEANUP_SETTINGS, trashRetentionDays: 5 }), /retention/);
	await assert.rejects(
		saveCleanupSettings(db, 'u1', { ...DEFAULT_CLEANUP_SETTINGS, sweep: { ...DEFAULT_CLEANUP_SETTINGS.sweep, olderThanDays: 1 } }),
		/age/
	);
	await saveCleanupSettings(db, 'u1', { trashRetentionDays: 30, sweep: { auto: true, olderThanDays: 180, onlyRead: false, keepStarred: true } });
});
