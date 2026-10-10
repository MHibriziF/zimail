import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import { MIGRATIONS } from '../../migrations/migrations.generated';
import { applyToNewDatabase } from '../../migrations/squash';
import { createD1AuthRepository, type LockPolicy } from '../repository';

/**
 * The throttle's correctness lives in its SQL (the count and the lock in one
 * UPDATE), so these run it in real SQLite, on the schema the migrations build.
 */
function d1Over(db: DatabaseSync): D1Database {
	function statement(sql: string, args: SQLInputValue[]) {
		return {
			bind: (...next: SQLInputValue[]) => statement(sql, next),
			first: async () => db.prepare(sql).get(...args) ?? null,
			all: async () => ({ results: db.prepare(sql).all(...args) }),
			run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
		};
	}
	return { prepare: (sql: string) => statement(sql, []) } as unknown as D1Database;
}

const POLICY: LockPolicy = { threshold: 10, baseLockMs: 60_000, maxLockMs: 3_600_000 };
const NOW = 1_800_000_000_000;

function setup() {
	const db = applyToNewDatabase(MIGRATIONS.filter((migration) => !migration.archived));
	db.prepare("INSERT INTO users (id, email, name, password_hash) VALUES ('u1', 'ada@example.com', 'Ada', 'hash')").run();
	return { db, repo: createD1AuthRepository(d1Over(db)) };
}

describe('AuthRepository — login throttle (SQLite)', () => {
	test('a new account starts unlocked with no failures', async () => {
		const { repo } = setup();
		const account = await repo.findLoginAccount('ADA@example.com');
		assert.equal(account?.user.id, 'u1');
		assert.equal(account?.passwordHash, 'hash');
		assert.equal(account?.lockedUntil, null);
		assert.deepEqual(await repo.readLoginGate('u1'), {
			failedLogins: 0,
			lockedUntil: null,
			totpSecret: null,
			totpEnabled: false,
			totpLastStep: null
		});
	});

	test('failures below the threshold count without locking', async () => {
		const { repo } = setup();
		for (let i = 0; i < 9; i++) assert.equal(await repo.recordLoginFailure('u1', 1, NOW, POLICY), null);
		assert.equal((await repo.readLoginGate('u1'))?.failedLogins, 9);
	});

	test('the threshold locks for the base time, then doubles, capped', async () => {
		const { repo } = setup();
		for (let i = 0; i < 9; i++) await repo.recordLoginFailure('u1', 1, NOW, POLICY);
		assert.equal(await repo.recordLoginFailure('u1', 1, NOW, POLICY), NOW + 60_000);
		assert.equal(await repo.recordLoginFailure('u1', 1, NOW, POLICY), NOW + 120_000);
		assert.equal(await repo.recordLoginFailure('u1', 2, NOW, POLICY), NOW + 480_000);
		for (let i = 0; i < 40; i++) await repo.recordLoginFailure('u1', 1, NOW, POLICY);
		assert.equal(await repo.recordLoginFailure('u1', 1, NOW, POLICY), NOW + 3_600_000);
	});

	test('clearing resets the count and the lock', async () => {
		const { repo } = setup();
		for (let i = 0; i < 10; i++) await repo.recordLoginFailure('u1', 1, NOW, POLICY);
		await repo.clearLoginFailures('u1');
		const gate = await repo.readLoginGate('u1');
		assert.equal(gate?.failedLogins, 0);
		assert.equal(gate?.lockedUntil, null);
	});

	test('a TOTP step can be claimed once, and never an older one after it', async () => {
		const { repo } = setup();
		assert.equal(await repo.claimTotpStep('u1', 100), true);
		assert.equal(await repo.claimTotpStep('u1', 100), false);
		assert.equal(await repo.claimTotpStep('u1', 99), false);
		assert.equal(await repo.claimTotpStep('u1', 101), true);
		assert.equal((await repo.readLoginGate('u1'))?.totpLastStep, 101);
	});

	test('an unknown account records nothing', async () => {
		const { repo } = setup();
		assert.equal(await repo.recordLoginFailure('nobody', 1, NOW, POLICY), null);
		assert.equal(await repo.claimTotpStep('nobody', 1), false);
	});
});
