import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1AuthRepository } from '../repository';

type UserRow = {
	id: string;
	email: string;
	name: string;
	password_hash: string;
	is_admin: number;
	must_change_password: number;
	recovery_email: string | null;
	recovery_email_pending: string | null;
	recovery_email_verified_at: string | null;
	totp_secret: string | null;
	totp_enabled: number;
	totp_enabled_at: string | null;
	email_signature: string;
	ui_theme: string | null;
	locale: string | null;
	created_at: string;
};

function userRow(overrides: Partial<UserRow> = {}): UserRow {
	return {
		id: 'user-1',
		email: 'ada@example.com',
		name: 'Ada',
		password_hash: 'hash',
		is_admin: 0,
		must_change_password: 0,
		recovery_email: null,
		recovery_email_pending: null,
		recovery_email_verified_at: null,
		totp_secret: null,
		totp_enabled: 0,
		totp_enabled_at: null,
		email_signature: '',
		ui_theme: null,
		locale: null,
		created_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

/** One in-memory `users` table (+ sessions/account_tokens/totp_backup_codes) backing every method. */
function setup(seed: Partial<UserRow>[] = []) {
	const users: UserRow[] = seed.map((row) => userRow(row));
	const sessions: Array<{ id: string; user_id: string; token_hash: string; expires_at: string }> = [];
	const accountTokens: Array<{ id: string; user_id: string; kind: string; token_hash: string; used_at: string | null; expires_at: string; created_at: string }> = [];
	const backupCodes: Array<{ id: string; user_id: string; code_hash: string; used_at: string | null }> = [];
	const queryLog: string[] = [];
	let clock = 0;

	const db = createFakeD1(({ sql, args }) => {
		queryLog.push(sql);
		if (sql === 'SELECT COUNT(*) AS count FROM users') return [{ count: users.length }];

		if (sql.includes('password_hash, is_admin, must_change_password, created_at FROM users WHERE email')) {
			return users.filter((u) => u.email === args[0]);
		}
		if (sql.startsWith('SELECT id, email, name, is_admin, must_change_password, created_at FROM users WHERE id')) {
			return users.filter((u) => u.id === args[0]);
		}
		if (sql.startsWith('SELECT id, email, name, is_admin, must_change_password, created_at FROM users ORDER')) {
			return [...users].sort((a, b) => a.created_at.localeCompare(b.created_at));
		}
		if (sql.startsWith('INSERT INTO users')) {
			const [id, email, name, passwordHash, isAdmin, mustChange] = args as [string, string, string, string, number, number];
			users.push(userRow({ id, email, name, password_hash: passwordHash, is_admin: isAdmin, must_change_password: mustChange }));
			return [];
		}
		if (sql === 'UPDATE users SET password_hash = ? WHERE id = ?') {
			const [hash, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) u.password_hash = hash;
			return u ? [u] : [];
		}
		if (sql === 'UPDATE users SET name = ? WHERE id = ?') {
			const [name, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) u.name = name;
			return u ? [u] : [];
		}
		if (sql === 'UPDATE users SET is_admin = 1 WHERE id = ?') {
			const u = users.find((e) => e.id === args[0]);
			if (u) u.is_admin = 1;
			return [];
		}
		if (sql.startsWith('UPDATE users SET is_admin = 0')) {
			const id = args[0] as string;
			const admins = users.filter((e) => e.is_admin === 1);
			const target = users.find((e) => e.id === id);
			if (!target) return [];
			if (target.is_admin === 0 || admins.length > 1) {
				target.is_admin = 0;
				return [target];
			}
			return [];
		}
		if (sql.startsWith('DELETE FROM users WHERE id = ? AND must_change_password')) {
			const idx = users.findIndex((e) => e.id === args[0] && e.must_change_password === 1);
			if (idx >= 0) users.splice(idx, 1);
			return [];
		}
		if (sql.startsWith('DELETE FROM users') && sql.includes('is_admin = 0 OR')) {
			const id = args[0] as string;
			const admins = users.filter((e) => e.is_admin === 1);
			const idx = users.findIndex((e) => e.id === id);
			if (idx < 0) return [];
			const target = users[idx];
			if (target.is_admin === 0 || admins.length > 1) {
				users.splice(idx, 1);
				return [target];
			}
			return [];
		}
		if (sql === 'SELECT password_hash FROM users WHERE id = ? AND must_change_password = 1') {
			return users.filter((u) => u.id === args[0] && u.must_change_password === 1);
		}
		if (sql.startsWith('UPDATE users') && sql.includes('must_change_password = 0')) {
			const [name, hash, id] = args as [string, string, string];
			const u = users.find((e) => e.id === id && e.must_change_password === 1);
			if (!u) return [];
			u.name = name;
			u.password_hash = hash;
			u.must_change_password = 0;
			return [u];
		}
		if (sql.startsWith('DELETE FROM sessions') && sql.includes('EXISTS')) {
			const [userId, , hash] = args as [string, string, string];
			const u = users.find((e) => e.id === userId && e.password_hash === hash && e.must_change_password === 0);
			if (u) {
				for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].user_id === userId) sessions.splice(i, 1);
			}
			return [];
		}
		if (sql.startsWith('DELETE FROM api_tokens') && sql.includes('EXISTS')) {
			return [];
		}
		if (sql.includes('FROM sessions s') && sql.includes('JOIN users u')) {
			const hash = args[0] as string;
			const session = sessions.find((s) => s.token_hash === hash && s.expires_at > new Date().toISOString());
			if (!session) return [];
			return users.filter((u) => u.id === session.user_id);
		}
		if (sql.startsWith('INSERT INTO sessions')) {
			const [id, userId, tokenHash, expiresAt] = args as [string, string, string, string];
			sessions.push({ id, user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
			return [];
		}
		if (sql === 'DELETE FROM sessions WHERE token_hash = ?') {
			const idx = sessions.findIndex((s) => s.token_hash === args[0]);
			if (idx >= 0) sessions.splice(idx, 1);
			return [];
		}
		if (sql === 'DELETE FROM sessions WHERE user_id = ?') {
			for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].user_id === args[0]) sessions.splice(i, 1);
			return [];
		}
		if (sql === 'DELETE FROM api_tokens WHERE user_id = ?') return [];
		if (sql === 'UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?') {
			return users.filter((u) => u.id === args[0]);
		}

		if (sql.includes('recovery_email, recovery_email_pending, recovery_email_verified_at FROM users')) {
			return users.filter((u) => u.id === args[0]);
		}
		if (sql === 'DELETE FROM account_tokens WHERE user_id = ? AND kind = ?') {
			const [userId, kind] = args as [string, string];
			for (let i = accountTokens.length - 1; i >= 0; i--) {
				if (accountTokens[i].user_id === userId && accountTokens[i].kind === kind) accountTokens.splice(i, 1);
			}
			return [];
		}
		if (sql.startsWith('INSERT INTO account_tokens')) {
			const [id, userId, kind, tokenHash, expiresAt] = args as [string, string, string, string, string];
			clock += 1;
			accountTokens.push({ id, user_id: userId, kind, token_hash: tokenHash, used_at: null, expires_at: expiresAt, created_at: `t${clock}` });
			return [];
		}
		if (sql.includes('FROM account_tokens') && sql.includes('kind = ? AND token_hash = ?')) {
			const [kind, hash, now] = args as [string, string, string];
			return accountTokens.filter((t) => t.kind === kind && t.token_hash === hash && t.used_at === null && t.expires_at > now);
		}
		if (sql === "UPDATE account_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL") {
			const t = accountTokens.find((e) => e.id === args[0] && e.used_at === null);
			if (!t) return [];
			t.used_at = 'used';
			return [t];
		}
		if (sql.includes('FROM account_tokens') && sql.includes('created_at > ?')) {
			const [userId, kind, cutoff] = args as [string, string, string];
			return accountTokens.filter((t) => t.user_id === userId && t.kind === kind && t.used_at === null && t.created_at > cutoff);
		}
		if (sql === 'UPDATE users SET recovery_email_pending = ? WHERE id = ?') {
			const [email, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) u.recovery_email_pending = email;
			return [];
		}
		if (sql === 'SELECT recovery_email_pending FROM users WHERE id = ?') {
			return users.filter((u) => u.id === args[0]);
		}
		if (sql.includes('SET recovery_email = ?, recovery_email_pending = NULL')) {
			const [email, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) {
				u.recovery_email = email;
				u.recovery_email_pending = null;
				u.recovery_email_verified_at = 'verified';
			}
			return [];
		}
		if (sql.includes('SET recovery_email = NULL, recovery_email_pending = NULL')) {
			const u = users.find((e) => e.id === args[0]);
			if (u) {
				u.recovery_email = null;
				u.recovery_email_pending = null;
				u.recovery_email_verified_at = null;
			}
			return [];
		}
		if (sql.startsWith("DELETE FROM account_tokens WHERE user_id = ? AND kind = 'recovery_email'")) {
			for (let i = accountTokens.length - 1; i >= 0; i--) {
				if (accountTokens[i].user_id === args[0] && accountTokens[i].kind === 'recovery_email') accountTokens.splice(i, 1);
			}
			return [];
		}
		if (sql.includes('FROM users') && sql.includes('recovery_email IS NOT NULL')) {
			const email = args[0] as string;
			return users.filter(
				(u) => u.email.toLowerCase() === String(email).toLowerCase() && u.recovery_email && u.recovery_email_verified_at
			);
		}

		if (sql === 'SELECT totp_secret, totp_enabled FROM users WHERE id = ?') {
			return users.filter((u) => u.id === args[0]);
		}
		if (sql === 'SELECT totp_enabled, totp_enabled_at FROM users WHERE id = ?') {
			return users.filter((u) => u.id === args[0]);
		}
		if (sql.startsWith('SELECT COUNT(*) AS count FROM totp_backup_codes')) {
			const userId = args[0] as string;
			return [{ count: backupCodes.filter((c) => c.user_id === userId && c.used_at === null).length }];
		}
		if (sql === 'UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?') {
			const [secret, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) {
				u.totp_secret = secret;
				u.totp_enabled = 0;
			}
			return [];
		}
		if (sql === 'DELETE FROM totp_backup_codes WHERE user_id = ?') {
			for (let i = backupCodes.length - 1; i >= 0; i--) if (backupCodes[i].user_id === args[0]) backupCodes.splice(i, 1);
			return [];
		}
		if (sql.startsWith('INSERT INTO totp_backup_codes')) {
			const [id, userId, hash] = args as [string, string, string];
			backupCodes.push({ id, user_id: userId, code_hash: hash, used_at: null });
			return [];
		}
		if (sql.includes("totp_enabled = 1, totp_enabled_at = datetime")) {
			const u = users.find((e) => e.id === args[0]);
			if (u) {
				u.totp_enabled = 1;
				u.totp_enabled_at = 'now';
			}
			return [];
		}
		if (sql.includes('totp_secret = NULL, totp_enabled = 0')) {
			const u = users.find((e) => e.id === args[0]);
			if (u) {
				u.totp_secret = null;
				u.totp_enabled = 0;
				u.totp_enabled_at = null;
			}
			return [];
		}
		if (sql.startsWith('SELECT id FROM totp_backup_codes')) {
			const [userId, hash] = args as [string, string];
			return backupCodes.filter((c) => c.user_id === userId && c.code_hash === hash && c.used_at === null);
		}
		if (sql === "UPDATE totp_backup_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL") {
			const c = backupCodes.find((e) => e.id === args[0] && e.used_at === null);
			if (!c) return [];
			c.used_at = 'used';
			return [c];
		}

		if (sql === 'SELECT email_signature FROM users WHERE id = ?') return users.filter((u) => u.id === args[0]);
		if (sql === 'UPDATE users SET email_signature = ? WHERE id = ?') {
			const [value, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) u.email_signature = value;
			return [];
		}
		if (sql === 'SELECT ui_theme FROM users WHERE id = ?') return users.filter((u) => u.id === args[0]);
		if (sql === 'UPDATE users SET ui_theme = ? WHERE id = ?') {
			const [theme, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) u.ui_theme = theme;
			return [];
		}
		if (sql === 'SELECT locale FROM users WHERE id = ?') return users.filter((u) => u.id === args[0]);
		if (sql === 'UPDATE users SET locale = ? WHERE id = ?') {
			const [locale, id] = args as [string, string];
			const u = users.find((e) => e.id === id);
			if (u) u.locale = locale;
			return [];
		}

		// The rest of deleteUserCascade's batch (attachments/emails/addresses/
		// push_subscriptions/domains cleanup) — not modeled here since these
		// tests only exercise the admin guard and the storage-key reporting.
		if (
			sql.includes('email_attachments') ||
			sql.includes('FROM emails') ||
			sql.includes('FROM addresses') ||
			sql.includes('push_subscriptions') ||
			sql.includes('UPDATE domains')
		) {
			return [];
		}

		throw new Error(`Unhandled query in fake D1: ${sql}`);
	});

	return { repo: createD1AuthRepository(db), users, sessions, accountTokens, backupCodes, queryLog };
}

describe('AuthRepository — users', () => {
	test('countUsers reflects how many rows exist', async () => {
		const { repo } = setup([{ id: 'a' }, { id: 'b' }]);
		assert.equal(await repo.countUsers(), 2);
	});

	test('insertUser then getUserById round-trips', async () => {
		const { repo } = setup();
		await repo.insertUser({ id: 'u1', email: 'ada@example.com', name: 'Ada', passwordHash: 'h', isAdmin: false, mustChangePassword: false });
		assert.equal((await repo.getUserById('u1'))?.name, 'Ada');
	});

	test('getUserByEmail returns the password hash', async () => {
		const { repo } = setup([{ email: 'ada@example.com', password_hash: 'secret-hash' }]);
		const found = await repo.getUserByEmail('ada@example.com');
		assert.equal(found?.passwordHash, 'secret-hash');
	});

	test('updatePasswordHash and updateName report whether a row changed', async () => {
		const { repo } = setup([{ id: 'u1' }]);
		assert.equal(await repo.updatePasswordHash('u1', 'new-hash'), true);
		assert.equal(await repo.updatePasswordHash('missing', 'x'), false);
		assert.equal(await repo.updateName('u1', 'New Name'), true);
	});

	test('listUsers returns everyone, oldest first', async () => {
		const { repo } = setup([
			{ id: 'a', created_at: '2026-01-02' },
			{ id: 'b', created_at: '2026-01-01' }
		]);
		assert.deepEqual((await repo.listUsers()).map((u) => u.id), ['b', 'a']);
	});

	test('cutSessionsAndTokens deletes both in one batch', async () => {
		const { repo, sessions } = setup([{ id: 'u1' }]);
		await repo.insertSession('s1', 'u1', 'hash-1', new Date(Date.now() + 60_000).toISOString());
		await repo.cutSessionsAndTokens('u1');
		assert.equal(sessions.length, 0);
	});

	test('deletePendingUser only removes a still-pending account', async () => {
		const { repo, users } = setup([{ id: 'u1', must_change_password: 1 }, { id: 'u2', must_change_password: 0 }]);
		await repo.deletePendingUser('u2');
		assert.equal(users.length, 2);
		await repo.deletePendingUser('u1');
		assert.equal(users.length, 1);
	});
});

describe('AuthRepository — first login', () => {
	test('getPasswordHashForFirstLogin only returns it while still pending', async () => {
		const { repo } = setup([{ id: 'u1', password_hash: 'temp-hash', must_change_password: 1 }]);
		assert.equal(await repo.getPasswordHashForFirstLogin('u1'), 'temp-hash');

		const { repo: repo2 } = setup([{ id: 'u2', must_change_password: 0 }]);
		assert.equal(await repo2.getPasswordHashForFirstLogin('u2'), null);
	});

	test('completeFirstLoginRow updates the row and cuts sessions/tokens, only while pending', async () => {
		const { repo, users, sessions } = setup([{ id: 'u1', must_change_password: 1, password_hash: 'old' }]);
		await repo.insertSession('s1', 'u1', 'hash-1', new Date(Date.now() + 60_000).toISOString());

		const changed = await repo.completeFirstLoginRow('u1', 'New Name', 'new-hash');
		assert.equal(changed, true);
		assert.equal(users[0].name, 'New Name');
		assert.equal(users[0].must_change_password, 0);
		assert.equal(sessions.length, 0);

		assert.equal(await repo.completeFirstLoginRow('u1', 'Again', 'x'), false);
	});
});

describe('AuthRepository — admin guard', () => {
	test('promoteAdmin has no guard', async () => {
		const { repo, users } = setup([{ id: 'u1', is_admin: 0 }]);
		await repo.promoteAdmin('u1');
		assert.equal(users[0].is_admin, 1);
	});

	test('demoteAdminGuarded refuses to demote the last admin', async () => {
		const { repo, users } = setup([{ id: 'admin-1', is_admin: 1 }]);
		assert.equal(await repo.demoteAdminGuarded('admin-1'), false);
		assert.equal(users[0].is_admin, 1);
	});

	test('demoteAdminGuarded succeeds when another admin remains', async () => {
		const { repo, users } = setup([
			{ id: 'admin-1', is_admin: 1 },
			{ id: 'admin-2', is_admin: 1 }
		]);
		assert.equal(await repo.demoteAdminGuarded('admin-1'), true);
		assert.equal(users[0].is_admin, 0);
	});

	test('demoting someone already not an admin is a no-op that still reports success', async () => {
		const { repo } = setup([{ id: 'admin-1', is_admin: 1 }, { id: 'user-2', is_admin: 0 }]);
		assert.equal(await repo.demoteAdminGuarded('user-2'), true);
	});
});

describe('AuthRepository — deleteUserCascade', () => {
	test('refuses to delete the last admin and touches nothing', async () => {
		const { repo, users } = setup([{ id: 'admin-1', is_admin: 1 }]);
		const result = await repo.deleteUserCascade('admin-1');
		assert.equal(result.succeeded, false);
		assert.equal(users.length, 1);
	});

	test('deletes the user and reports the attachment storage keys to purge', async () => {
		const { repo, users } = setup([{ id: 'user-1', is_admin: 0 }]);
		const result = await repo.deleteUserCascade('user-1');
		assert.equal(result.succeeded, true);
		assert.equal(users.length, 0);
		assert.deepEqual(result.storageKeys, []);
	});

	test('reads attachment keys, deletes the user, then clears every child table in one batch, in order', async () => {
		// Older D1 databases were created without ON DELETE CASCADE enforced, so
		// the user row going away is not enough on its own — and the storage-key
		// read has to happen inside the same transaction as the delete, or
		// inbound delivery could commit an attachment between the two.
		const { repo, queryLog } = setup([{ id: 'user-1', is_admin: 0 }]);
		const before = queryLog.length;

		await repo.deleteUserCascade('user-1');
		const batch = queryLog.slice(before);

		assert.match(batch[0], /SELECT storage_key FROM email_attachments/);
		const userDeleteAt = batch.findIndex((sql) => sql.startsWith('DELETE FROM users'));
		assert.ok(userDeleteAt > 0, 'the key read must precede the delete');

		for (const table of ['email_attachments', 'emails', 'addresses', 'sessions', 'api_tokens', 'push_subscriptions']) {
			const at = batch.findIndex((sql) => sql.includes(`DELETE FROM ${table}`));
			assert.ok(at > userDeleteAt, `expected DELETE FROM ${table} after the user delete`);
		}
		assert.ok(batch.some((sql) => sql.includes('UPDATE domains SET catchall_user_id = NULL')));

		// Attachment metadata is reachable only through emails, so it must go first.
		const attachmentsAt = batch.findIndex((sql) => sql.includes('DELETE FROM email_attachments'));
		const emailsAt = batch.findIndex((sql) => sql.includes('DELETE FROM emails'));
		assert.ok(attachmentsAt < emailsAt);

		// Every child statement is gated on the account actually being gone, so a
		// refused delete cannot strip an account that survives.
		for (const sql of batch.slice(userDeleteAt + 1)) {
			assert.match(sql, /NOT EXISTS \(SELECT 1 FROM users WHERE id = \?\)/);
		}
	});
});

describe('AuthRepository — sessions', () => {
	test('insertSession then getUserFromSessionByTokenHash round-trips', async () => {
		const { repo } = setup([{ id: 'u1', name: 'Ada' }]);
		await repo.insertSession('s1', 'u1', 'hash-1', new Date(Date.now() + 60_000).toISOString());
		assert.equal((await repo.getUserFromSessionByTokenHash('hash-1'))?.name, 'Ada');
	});

	test('an expired session is not returned', async () => {
		const { repo } = setup([{ id: 'u1' }]);
		await repo.insertSession('s1', 'u1', 'hash-1', new Date(Date.now() - 60_000).toISOString());
		assert.equal(await repo.getUserFromSessionByTokenHash('hash-1'), null);
	});

	test('deleteSessionByTokenHash removes the session', async () => {
		const { repo, sessions } = setup([{ id: 'u1' }]);
		await repo.insertSession('s1', 'u1', 'hash-1', new Date(Date.now() + 60_000).toISOString());
		await repo.deleteSessionByTokenHash('hash-1');
		assert.equal(sessions.length, 0);
	});
});

describe('AuthRepository — account tokens (recovery)', () => {
	test('replaceAccountToken retires the previous live token of that kind', async () => {
		const { repo, accountTokens } = setup();
		await repo.replaceAccountToken('u1', 'password_reset', 'hash-1', '2099-01-01');
		await repo.replaceAccountToken('u1', 'password_reset', 'hash-2', '2099-01-01');
		assert.equal(accountTokens.length, 1);
		assert.equal(accountTokens[0].token_hash, 'hash-2');
	});

	test('findLiveToken + markTokenUsed: only the first of two racers wins', async () => {
		const { repo } = setup();
		await repo.replaceAccountToken('u1', 'password_reset', 'hash-1', '2099-01-01');
		const found = await repo.findLiveToken('password_reset', 'hash-1', '2026-01-01');
		assert.equal(found?.userId, 'u1');

		const [first, second] = await Promise.all([
			repo.markTokenUsed(found!.id),
			repo.markTokenUsed(found!.id)
		]);
		assert.equal([first, second].filter(Boolean).length, 1);
	});

	test('findLiveToken ignores an expired or wrong-kind token', async () => {
		const { repo } = setup();
		await repo.replaceAccountToken('u1', 'recovery_email', 'hash-1', '2099-01-01');
		assert.equal(await repo.findLiveToken('password_reset', 'hash-1', '2026-01-01'), null);
		assert.equal(await repo.findLiveToken('recovery_email', 'hash-1', '2100-01-01'), null);
	});

	test('hasRecentToken reflects the cooldown window', async () => {
		const { repo, accountTokens } = setup();
		await repo.replaceAccountToken('u1', 'password_reset', 'hash-1', '2099-01-01');
		accountTokens[0].created_at = 'now';
		assert.equal(await repo.hasRecentToken('u1', 'password_reset', 'before'), true);
		assert.equal(await repo.hasRecentToken('u1', 'password_reset', 'zzz'), false);
	});

	test('getRecoveryStatus reports the verified, pending, and verified-at columns', async () => {
		const { repo } = setup([{ id: 'u1', recovery_email: 'a@b.com', recovery_email_pending: null, recovery_email_verified_at: 'then' }]);
		assert.deepEqual(await repo.getRecoveryStatus('u1'), { email: 'a@b.com', pending: null, verifiedAt: 'then' });
	});

	test('setPendingRecoveryEmail / getPendingRecoveryEmail round-trip', async () => {
		const { repo } = setup([{ id: 'u1' }]);
		await repo.setPendingRecoveryEmail('u1', 'new@example.com');
		assert.equal(await repo.getPendingRecoveryEmail('u1'), 'new@example.com');
	});

	test('promoteRecoveryEmail moves the pending address into the verified column', async () => {
		const { repo, users } = setup([{ id: 'u1', recovery_email_pending: 'new@example.com' }]);
		await repo.promoteRecoveryEmail('u1', 'new@example.com');
		assert.equal(users[0].recovery_email, 'new@example.com');
		assert.equal(users[0].recovery_email_pending, null);
	});

	test('clearRecoveryEmailRow clears the columns and any live recovery_email token', async () => {
		const { repo, users, accountTokens } = setup([{ id: 'u1', recovery_email: 'old@example.com' }]);
		await repo.replaceAccountToken('u1', 'recovery_email', 'hash-1', '2099-01-01');
		await repo.clearRecoveryEmailRow('u1');
		assert.equal(users[0].recovery_email, null);
		assert.equal(accountTokens.length, 0);
	});

	test('findResetTarget only matches a verified recovery address', async () => {
		const { repo } = setup([
			{ id: 'ada', email: 'ada@example.com', recovery_email: 'ada-recovery@example.com', recovery_email_verified_at: 'verified' },
			{ id: 'grace', email: 'grace@example.com', recovery_email_pending: 'grace-recovery@example.com' }
		]);
		assert.deepEqual(await repo.findResetTarget('ADA@example.com'), {
			userId: 'ada',
			recoveryEmail: 'ada-recovery@example.com'
		});
		assert.equal(await repo.findResetTarget('grace@example.com'), null);
	});
});

describe('AuthRepository — 2FA', () => {
	test('setPendingTotpSecret stores an unconfirmed secret, readTotp/getTwoFactorStatusRow reflect it', async () => {
		const { repo } = setup([{ id: 'u1' }]);
		await repo.setPendingTotpSecret('u1', 'SECRET123');
		assert.deepEqual(await repo.readTotp('u1'), { secret: 'SECRET123', enabled: false });
		assert.deepEqual(await repo.getTwoFactorStatusRow('u1'), { enabled: false, enabledAt: null });

		await repo.enableTotp('u1');
		assert.deepEqual(await repo.readTotp('u1'), { secret: 'SECRET123', enabled: true });
		assert.equal((await repo.getTwoFactorStatusRow('u1')).enabled, true);
	});

	test('replaceBackupCodes deletes the old set and inserts the new one', async () => {
		const { repo, backupCodes } = setup();
		await repo.replaceBackupCodes('u1', ['h1', 'h2']);
		assert.equal(backupCodes.length, 2);
		await repo.replaceBackupCodes('u1', ['h3']);
		assert.equal(backupCodes.length, 1);
		assert.equal(backupCodes[0].code_hash, 'h3');
	});

	test('countUnusedBackupCodes ignores already-spent codes', async () => {
		const { repo, backupCodes } = setup();
		await repo.replaceBackupCodes('u1', ['h1', 'h2']);
		backupCodes[0].used_at = 'used';
		assert.equal(await repo.countUnusedBackupCodes('u1'), 1);
	});

	test('findBackupCodeByHash + markBackupCodeUsed: only the first of two racers wins', async () => {
		const { repo } = setup();
		await repo.replaceBackupCodes('u1', ['h1']);
		const found = await repo.findBackupCodeByHash('u1', 'h1');
		const [first, second] = await Promise.all([
			repo.markBackupCodeUsed(found!.id),
			repo.markBackupCodeUsed(found!.id)
		]);
		assert.equal([first, second].filter(Boolean).length, 1);
	});

	test('disableTotpCascade clears the secret and every backup code', async () => {
		const { repo, users, backupCodes } = setup([{ id: 'u1', totp_secret: 's', totp_enabled: 1 }]);
		await repo.replaceBackupCodes('u1', ['h1']);
		await repo.disableTotpCascade('u1');
		assert.equal(users[0].totp_secret, null);
		assert.equal(users[0].totp_enabled, 0);
		assert.equal(backupCodes.length, 0);
	});
});

describe('AuthRepository — profile settings', () => {
	test('email signature, ui theme, and locale round-trip', async () => {
		const { repo } = setup([{ id: 'u1' }]);
		await repo.setEmailSignature('u1', 'Cheers');
		assert.equal(await repo.getEmailSignature('u1'), 'Cheers');

		await repo.setUiTheme('u1', 'dark');
		assert.equal(await repo.getUiTheme('u1'), 'dark');

		await repo.setLocale('u1', 'fr');
		assert.equal(await repo.getLocale('u1'), 'fr');
	});
});
