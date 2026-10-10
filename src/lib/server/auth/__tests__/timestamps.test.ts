import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createSqliteD1 } from '../../__tests__/support/sqlite-d1';
import { createD1AuthRepository } from '../repository';
import { createAuthService } from '../service';

// SQLite writes `2026-10-10 03:00:31` and JavaScript writes `2026-10-10T03:00:31.000Z`.
// Compared as text, ' ' sorts below 'T', so these run against real SQLite (#182).
function setup() {
	const { db, sqlite } = createSqliteD1();
	sqlite.exec("INSERT INTO users (id, email, name, password_hash) VALUES ('user-1', 'ada@example.com', 'Ada', 'hash')");
	const repo = createD1AuthRepository(db);
	return { repo, service: createAuthService(repo), sqlite };
}

describe('auth timestamps against SQLite', () => {
	test('a reset token issued just now counts as recent', async () => {
		const { service } = setup();
		assert.equal(await service.hasRecentResetToken('user-1'), false);

		await service.createPasswordResetToken('user-1');

		assert.equal(await service.hasRecentResetToken('user-1'), true);
	});

	test('a reset token older than the cooldown is not recent', async () => {
		const { service, sqlite } = setup();
		await service.createPasswordResetToken('user-1');
		sqlite.exec("UPDATE account_tokens SET created_at = datetime('now', '-3 minutes')");

		assert.equal(await service.hasRecentResetToken('user-1'), false);
	});

	test('a session that expired an hour ago is rejected', async () => {
		const { repo } = setup();
		await repo.insertSession('s-1', 'user-1', 'hash-1', new Date(Date.now() - 3_600_000).toISOString());

		assert.equal(await repo.getUserFromSessionByTokenHash('hash-1'), null);
	});

	test('a session that expires in an hour is accepted', async () => {
		const { repo } = setup();
		await repo.insertSession('s-1', 'user-1', 'hash-1', new Date(Date.now() + 3_600_000).toISOString());

		assert.equal((await repo.getUserFromSessionByTokenHash('hash-1'))?.id, 'user-1');
	});
});
