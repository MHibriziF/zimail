import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import { hashPassword, hashToken } from '../../util/crypto';
import { generateTotpSecret, totpCode } from '../../util/totp';
import type {
	AccountTokenKind,
	AuthRepository,
	NewUser,
	RecoveryStatusRow,
	TwoFactorStatusRow
} from '../repository';
import { createAuthService, normalizeBackupCode, readSessionToken, sessionCookieOptions } from '../service';

function user(overrides: Partial<User> = {}): User {
	return {
		id: 'user-1',
		email: 'ada@example.com',
		name: 'Ada',
		is_admin: false,
		must_change_password: false,
		created_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

/** In-memory `AuthRepository` — a plain object standing in for D1. */
function fakeRepo(overrides: Partial<AuthRepository> = {}) {
	type FakeUser = User & { passwordHash: string; signature: string; theme: string | null; locale: string | null };

	const users = new Map<string, FakeUser>();
	const sessions = new Map<string, string>(); // tokenHash -> userId
	const tokens = new Map<string, { userId: string; kind: AccountTokenKind; used: boolean; expiresAt: string; createdAt: string }>();
	const recovery = new Map<string, RecoveryStatusRow>();
	const totp = new Map<string, { secret: string | null; enabled: boolean }>();
	const backupCodes = new Map<string, Set<string>>(); // userId -> set of code hashes still unused
	const spentBackupCodes = new Set<string>();
	const throttle = new Map<string, { failedLogins: number; lockedUntil: number | null; totpLastStep: number | null }>();
	const writes: string[] = [];

	function addUser(u: User & { passwordHash: string }) {
		users.set(u.id, { ...u, signature: '', theme: null, locale: null });
		recovery.set(u.id, { email: null, pending: null, verifiedAt: null });
		totp.set(u.id, { secret: null, enabled: false });
		backupCodes.set(u.id, new Set());
		throttle.set(u.id, { failedLogins: 0, lockedUntil: null, totpLastStep: null });
	}

	const base: AuthRepository = {
		async countUsers() {
			return users.size;
		},
		async getUserByEmail(email) {
			for (const u of users.values()) if (u.email === email) return u;
			return null;
		},
		async getUserById(id) {
			const u = users.get(id);
			return u ? { ...u } : null;
		},
		async listUsers() {
			return [...users.values()];
		},
		async insertUser(input: NewUser) {
			addUser({
				id: input.id,
				email: input.email,
				name: input.name,
				is_admin: input.isAdmin,
				must_change_password: input.mustChangePassword,
				created_at: '2026-01-01T00:00:00.000Z',
				passwordHash: input.passwordHash
			});
		},
		async updatePasswordHash(userId, passwordHash) {
			const u = users.get(userId);
			if (!u) return false;
			u.passwordHash = passwordHash;
			return true;
		},
		async cutSessionsAndTokens(userId) {
			for (const [hash, uid] of sessions) if (uid === userId) sessions.delete(hash);
		},
		async updateName(userId, name) {
			const u = users.get(userId);
			if (!u) return false;
			u.name = name;
			return true;
		},
		async promoteAdmin(userId) {
			const u = users.get(userId);
			if (u) u.is_admin = true;
		},
		async demoteAdminGuarded(userId) {
			const u = users.get(userId);
			if (!u) return false;
			const admins = [...users.values()].filter((e) => e.is_admin);
			if (u.is_admin && admins.length <= 1) return false;
			u.is_admin = false;
			return true;
		},
		async deleteUserCascade(targetId) {
			const u = users.get(targetId);
			if (!u) return { succeeded: false, storageKeys: [] };
			const admins = [...users.values()].filter((e) => e.is_admin);
			if (u.is_admin && admins.length <= 1) return { succeeded: false, storageKeys: [] };
			users.delete(targetId);
			return { succeeded: true, storageKeys: [] };
		},
		async deletePendingUser(userId) {
			const u = users.get(userId);
			if (u?.must_change_password) users.delete(userId);
		},
		async getPasswordHashForFirstLogin(userId) {
			const u = users.get(userId);
			return u?.must_change_password ? u.passwordHash : null;
		},
		async completeFirstLoginRow(userId, name, passwordHash) {
			const u = users.get(userId);
			if (!u?.must_change_password) return false;
			u.name = name;
			u.passwordHash = passwordHash;
			u.must_change_password = false;
			return true;
		},
		async getUserFromSessionByTokenHash(tokenHash) {
			const userId = sessions.get(tokenHash);
			if (!userId) return null;
			const u = users.get(userId);
			return u ? { ...u } : null;
		},
		async insertSession(_sessionId, userId, tokenHash) {
			sessions.set(tokenHash, userId);
		},
		async deleteSessionByTokenHash(tokenHash) {
			sessions.delete(tokenHash);
		},

		async getRecoveryStatus(userId) {
			return recovery.get(userId) ?? { email: null, pending: null, verifiedAt: null };
		},
		async replaceAccountToken(userId, kind, tokenHash) {
			for (const [hash, t] of tokens) if (t.userId === userId && t.kind === kind && !t.used) tokens.delete(hash);
			tokens.set(tokenHash, { userId, kind, used: false, expiresAt: '2099-01-01', createdAt: new Date().toISOString() });
		},
		async findLiveToken(kind, tokenHash, now) {
			const t = tokens.get(tokenHash);
			if (!t || t.kind !== kind || t.used || t.expiresAt <= now) return null;
			return { id: tokenHash, userId: t.userId };
		},
		async markTokenUsed(id) {
			const t = tokens.get(id);
			if (!t || t.used) return false;
			t.used = true;
			return true;
		},
		async hasRecentToken(userId, kind, cutoff) {
			for (const t of tokens.values()) {
				if (t.userId === userId && t.kind === kind && !t.used && t.createdAt > cutoff) return true;
			}
			return false;
		},
		async setPendingRecoveryEmail(userId, email) {
			const status = recovery.get(userId);
			if (status) status.pending = email;
		},
		async getPendingRecoveryEmail(userId) {
			return recovery.get(userId)?.pending ?? null;
		},
		async promoteRecoveryEmail(userId, email) {
			const status = recovery.get(userId);
			if (status) {
				status.email = email;
				status.pending = null;
				status.verifiedAt = 'now';
			}
		},
		async clearRecoveryEmailRow(userId) {
			recovery.set(userId, { email: null, pending: null, verifiedAt: null });
			for (const [hash, t] of tokens) if (t.userId === userId && t.kind === 'recovery_email') tokens.delete(hash);
		},
		async findResetTarget(email) {
			for (const u of users.values()) {
				const status = recovery.get(u.id);
				if (u.email === email && status?.email && status.verifiedAt) {
					return { userId: u.id, recoveryEmail: status.email };
				}
			}
			return null;
		},

		async readTotp(userId) {
			return totp.get(userId) ?? null;
		},
		async getTwoFactorStatusRow(userId): Promise<TwoFactorStatusRow> {
			const row = totp.get(userId);
			return { enabled: row?.enabled ?? false, enabledAt: row?.enabled ? 'now' : null };
		},
		async countUnusedBackupCodes(userId) {
			return backupCodes.get(userId)?.size ?? 0;
		},
		async setPendingTotpSecret(userId, secret) {
			totp.set(userId, { secret, enabled: false });
		},
		async replaceBackupCodes(userId, hashedCodes) {
			backupCodes.set(userId, new Set(hashedCodes));
		},
		async enableTotp(userId) {
			const row = totp.get(userId);
			if (row) row.enabled = true;
		},
		async disableTotpCascade(userId) {
			totp.set(userId, { secret: null, enabled: false });
			backupCodes.set(userId, new Set());
		},
		async findBackupCodeByHash(userId, codeHash) {
			const set = backupCodes.get(userId);
			return set?.has(codeHash) && !spentBackupCodes.has(`${userId}:${codeHash}`) ? { id: `${userId}:${codeHash}` } : null;
		},
		async markBackupCodeUsed(id) {
			if (spentBackupCodes.has(id)) return false;
			spentBackupCodes.add(id);
			return true;
		},

		async findLoginAccount(email) {
			for (const u of users.values()) {
				if (u.email !== email) continue;
				const { passwordHash, signature: _s, theme: _t, locale: _l, ...rest } = u;
				return { user: rest, passwordHash, lockedUntil: throttle.get(u.id)?.lockedUntil ?? null };
			}
			return null;
		},
		async readLoginGate(userId) {
			const row = throttle.get(userId);
			const factor = totp.get(userId);
			if (!row || !factor) return null;
			return { ...row, totpSecret: factor.secret, totpEnabled: factor.enabled };
		},
		async recordLoginFailure(userId, weight, nowMs, policy) {
			writes.push('recordLoginFailure');
			const row = throttle.get(userId);
			if (!row) return null;
			row.failedLogins += weight;
			if (row.failedLogins >= policy.threshold) {
				const past = Math.min(row.failedLogins - policy.threshold, 30);
				row.lockedUntil = nowMs + Math.min(policy.maxLockMs, policy.baseLockMs * 2 ** past);
			}
			return row.lockedUntil;
		},
		async clearLoginFailures(userId) {
			writes.push('clearLoginFailures');
			const row = throttle.get(userId);
			if (row) Object.assign(row, { failedLogins: 0, lockedUntil: null });
		},
		async claimTotpStep(userId, step) {
			writes.push('claimTotpStep');
			const row = throttle.get(userId);
			if (!row || (row.totpLastStep !== null && row.totpLastStep >= step)) return false;
			row.totpLastStep = step;
			return true;
		},

		async getEmailSignature(userId) {
			return users.get(userId)?.signature ?? '';
		},
		async setEmailSignature(userId, value) {
			const u = users.get(userId);
			if (u) u.signature = value;
		},
		async getUiTheme(userId) {
			return users.get(userId)?.theme ?? null;
		},
		async setUiTheme(userId, theme) {
			const u = users.get(userId);
			if (u) u.theme = theme;
		},
		async getLocale(userId) {
			return users.get(userId)?.locale ?? null;
		},
		async setLocale(userId, locale) {
			const u = users.get(userId);
			if (u) u.locale = locale;
		},

		...overrides
	};

	return { repo: base, addUser, users, throttle, writes };
}

describe('pure helpers', () => {
	test('sessionCookieOptions carries the max age through', () => {
		assert.equal(sessionCookieOptions(60).maxAge, 60);
		assert.equal(sessionCookieOptions(60).httpOnly, true);
	});

	test('readSessionToken reads the session cookie', () => {
		const cookies = { get: (name: string) => (name === 'mail_session' ? 'the-token' : undefined) };
		assert.equal(readSessionToken(cookies), 'the-token');
	});
});

describe('createUser', () => {
	test('rejects a malformed email', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		await assert.rejects(
			service.createUser({ email: 'not-an-email', name: 'Ada', password: 'password123' }),
			/valid email/
		);
	});

	test('rejects a duplicate email', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ id: 'u1', email: 'ada@example.com', name: 'Ada', is_admin: false, must_change_password: false, created_at: 't', passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(
			service.createUser({ email: 'ada@example.com', name: 'Ada 2', password: 'password123' }),
			/already exists/
		);
	});

	test('lowercases and trims the email, hashes the password', async () => {
		const { repo, users } = fakeRepo();
		const service = createAuthService(repo);
		const created = await service.createUser({ email: '  Ada@Example.com ', name: '  Ada  ', password: 'password123' });
		assert.equal(created.email, 'ada@example.com');
		assert.equal(created.name, 'Ada');
		assert.notEqual(users.get(created.id)?.passwordHash, 'password123');
	});
});

describe('bootstrapAdmin', () => {
	test('refuses once any user exists', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ id: 'u1', email: 'a@b.com', name: 'A', is_admin: false, must_change_password: false, created_at: 't', passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(
			service.bootstrapAdmin({ email: 'new@example.com', name: 'New', password: 'password123' }),
			/already completed/
		);
	});

	test('creates the first user as an admin', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		const admin = await service.bootstrapAdmin({ email: 'ada@example.com', name: 'Ada', password: 'password123' });
		assert.equal(admin.is_admin, true);
	});
});

describe('login', () => {
	async function withUser(overrides: Partial<User> = {}) {
		const { repo, addUser } = fakeRepo();
		addUser({
			...user(overrides),
			passwordHash: await hashPassword('correct-password')
		});
		return { repo };
	}

	test('rejects an unknown email', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		assert.deepEqual(await service.login('nobody@example.com', 'x'), { ok: false, reason: 'invalid' });
	});

	test('rejects a wrong password', async () => {
		const { repo } = await withUser();
		const service = createAuthService(repo);
		const result = await service.login('ada@example.com', 'wrong-password');
		assert.deepEqual(result, { ok: false, reason: 'invalid' });
	});

	test('succeeds and starts a session when there is no second factor', async () => {
		const { repo } = await withUser();
		const service = createAuthService(repo);
		const result = await service.login('ada@example.com', 'correct-password');
		assert.equal(result.ok, true);
		if (result.ok) assert.ok(result.token);
	});

	test('asks for a code when two-factor is enabled', async () => {
		const { repo } = await withUser();
		const secret = generateTotpSecret();
		await repo.setPendingTotpSecret('user-1', secret);
		await repo.enableTotp('user-1');

		const service = createAuthService(repo);
		assert.deepEqual(await service.login('ada@example.com', 'correct-password'), {
			ok: false,
			reason: 'totp_required'
		});
	});

	test('rejects an invalid code once enrolled', async () => {
		const { repo } = await withUser();
		await repo.setPendingTotpSecret('user-1', generateTotpSecret());
		await repo.enableTotp('user-1');

		const service = createAuthService(repo);
		assert.deepEqual(await service.login('ada@example.com', 'correct-password', '000000'), {
			ok: false,
			reason: 'totp_invalid'
		});
	});

	test('succeeds with a valid code once enrolled', async () => {
		const { repo } = await withUser();
		const secret = generateTotpSecret();
		await repo.setPendingTotpSecret('user-1', secret);
		await repo.enableTotp('user-1');

		const service = createAuthService(repo);
		const result = await service.login('ada@example.com', 'correct-password', await totpCode(secret));
		assert.equal(result.ok, true);
	});
});

describe('login throttling', () => {
	const START = Date.UTC(2026, 9, 10, 12, 0, 0);

	async function setup({ twoFactor = false } = {}) {
		const fake = fakeRepo();
		fake.addUser({ ...user(), passwordHash: await hashPassword('correct-password') });
		let secret = '';
		if (twoFactor) {
			secret = generateTotpSecret();
			await fake.repo.setPendingTotpSecret('user-1', secret);
			await fake.repo.enableTotp('user-1');
		}
		const clock = { ms: START };
		const service = createAuthService(fake.repo, { now: () => clock.ms });
		return { ...fake, service, clock, secret };
	}

	async function failPasswords(service: ReturnType<typeof createAuthService>, times: number) {
		for (let i = 0; i < times; i++) await service.login('ada@example.com', 'wrong-password');
	}

	test('a normal sign-in writes nothing to the throttle', async () => {
		const { service, writes } = await setup();
		assert.equal((await service.login('ada@example.com', 'correct-password')).ok, true);
		assert.deepEqual(writes, []);
	});

	test('ten wrong passwords lock the account, even against the right one', async () => {
		const { service, writes } = await setup();
		await failPasswords(service, 9);
		assert.deepEqual(await service.login('ada@example.com', 'wrong-password'), {
			ok: false,
			reason: 'locked',
			retryAfterSeconds: 60
		});

		const writesBefore = writes.length;
		assert.deepEqual(await service.login('ada@example.com', 'correct-password'), {
			ok: false,
			reason: 'locked',
			retryAfterSeconds: 60
		});
		assert.equal(writes.length, writesBefore, 'a refused attempt while locked costs no write');
	});

	test('the lock expires, and a success then resets the count', async () => {
		const { service, clock, throttle } = await setup();
		await failPasswords(service, 10);

		clock.ms += 61_000;
		assert.equal((await service.login('ada@example.com', 'correct-password')).ok, true);
		assert.deepEqual(throttle.get('user-1'), { failedLogins: 0, lockedUntil: null, totpLastStep: null });
	});

	test('each failure past the threshold doubles the lock, up to an hour', async () => {
		const { service, clock } = await setup();
		await failPasswords(service, 10);

		clock.ms += 61_000;
		const second = await service.login('ada@example.com', 'wrong-password');
		assert.deepEqual(second, { ok: false, reason: 'locked', retryAfterSeconds: 120 });

		for (let i = 0; i < 10; i++) {
			clock.ms += 60 * 60_000 + 1;
			await service.login('ada@example.com', 'wrong-password');
		}
		const capped = await service.login('ada@example.com', 'correct-password');
		assert.deepEqual(capped, { ok: false, reason: 'locked', retryAfterSeconds: 3600 });
	});

	test('a success after a few failures clears them', async () => {
		const { service, throttle, writes } = await setup();
		await failPasswords(service, 3);
		assert.equal(throttle.get('user-1')?.failedLogins, 3);

		assert.equal((await service.login('ada@example.com', 'correct-password')).ok, true);
		assert.equal(throttle.get('user-1')?.failedLogins, 0);
		assert.equal(writes.at(-1), 'clearLoginFailures');
	});

	test('five wrong codes lock the account', async () => {
		const { service } = await setup({ twoFactor: true });
		for (let i = 0; i < 4; i++) {
			assert.equal(
				((await service.login('ada@example.com', 'correct-password', '000000')) as { reason: string }).reason,
				'totp_invalid'
			);
		}
		assert.equal(
			((await service.login('ada@example.com', 'correct-password', '000000')) as { reason: string }).reason,
			'locked'
		);
	});

	test('asking for the code costs nothing; it is not a failure', async () => {
		const { service, writes } = await setup({ twoFactor: true });
		assert.equal(((await service.login('ada@example.com', 'correct-password')) as { reason: string }).reason, 'totp_required');
		assert.deepEqual(writes, []);
	});

	test('an authenticator code works once, and an older one never after it', async () => {
		const { service, clock, secret } = await setup({ twoFactor: true });
		const code = await totpCode(secret, clock.ms);
		assert.equal((await service.login('ada@example.com', 'correct-password', code)).ok, true);
		assert.deepEqual(await service.login('ada@example.com', 'correct-password', code), {
			ok: false,
			reason: 'totp_invalid'
		});

		const previous = await totpCode(secret, clock.ms - 30_000);
		assert.equal(
			((await service.login('ada@example.com', 'correct-password', previous)) as { reason: string }).reason,
			'totp_invalid'
		);

		clock.ms += 30_000;
		assert.equal((await service.login('ada@example.com', 'correct-password', await totpCode(secret, clock.ms))).ok, true);
	});

	test('an unknown email is refused without touching the throttle', async () => {
		const { service, writes } = await setup();
		assert.deepEqual(await service.login('nobody@example.com', 'x'), { ok: false, reason: 'invalid' });
		assert.deepEqual(writes, []);
	});
});

describe('logout / getUserFromSession', () => {
	test('logout removes the session; getUserFromSession then finds nobody', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		const { token } = await service.startSession(user());

		assert.equal((await service.getUserFromSession(token))?.id, 'user-1');
		await service.logout(token);
		assert.equal(await service.getUserFromSession(token), null);
	});

	test('getUserFromSession returns null for an empty token', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		assert.equal(await service.getUserFromSession(undefined), null);
	});
});

describe('setUserPassword', () => {
	test('rejects a short password', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(service.setUserPassword('user-1', 'short'), /at least/);
	});

	test('rejects an unknown user', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		await assert.rejects(service.setUserPassword('nobody', 'password123'), /not found/);
	});

	test('rotates the hash and cuts every session', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'old' });
		await repo.insertSession('s1', 'user-1', 'tok-1', '2099-01-01');
		const service = createAuthService(repo);

		await service.setUserPassword('user-1', 'new-password-123');
		assert.equal(await repo.getUserFromSessionByTokenHash('tok-1'), null);
	});
});

describe('setUserName', () => {
	test('rejects an empty or overlong name', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(service.setUserName('user-1', '   '), /cannot be empty/);
		await assert.rejects(service.setUserName('user-1', 'x'.repeat(300)), /characters or fewer/);
	});

	test('trims and saves the name', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		const updated = await service.setUserName('user-1', '  New Name  ');
		assert.equal(updated.name, 'New Name');
	});

	test('rejects an unknown user', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		await assert.rejects(service.setUserName('nobody', 'New Name'), /not found/);
	});
});

describe('setUserAdmin', () => {
	test('refuses to change the actor\'s own role', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ id: 'admin-1', is_admin: true }), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(service.setUserAdmin(user({ id: 'admin-1' }), 'admin-1', false), /own role/);
	});

	test('rejects an unknown target', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		await assert.rejects(service.setUserAdmin(user({ id: 'admin-1' }), 'nobody', true), /not found/);
	});

	test('promotes without a guard', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ id: 'target', is_admin: false }), passwordHash: 'h' });
		addUser({ ...user({ id: 'admin-1', is_admin: true }), passwordHash: 'h' });
		const service = createAuthService(repo);

		await service.setUserAdmin(user({ id: 'admin-1' }), 'target', true);
		assert.equal((await repo.getUserById('target'))?.is_admin, true);
	});

	test('refuses to demote the last admin', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ id: 'admin-1', is_admin: true }), passwordHash: 'h' });
		const service = createAuthService(repo);

		await assert.rejects(
			service.setUserAdmin(user({ id: 'someone-else' }), 'admin-1', false),
			/Keep at least one admin/
		);
		assert.equal((await repo.getUserById('admin-1'))?.is_admin, true);
	});

	test('demotes successfully when another admin remains', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ id: 'admin-1', is_admin: true }), passwordHash: 'h' });
		addUser({ ...user({ id: 'admin-2', is_admin: true }), passwordHash: 'h' });
		const service = createAuthService(repo);

		await service.setUserAdmin(user({ id: 'admin-2' }), 'admin-1', false);
		assert.equal((await repo.getUserById('admin-1'))?.is_admin, false);
	});
});

describe('deleteUser', () => {
	function bucket(deleted: string[], failOn?: string): R2Bucket {
		return {
			async delete(key: string) {
				if (failOn === key) throw new Error('R2 unavailable');
				deleted.push(key);
			}
		} as unknown as R2Bucket;
	}

	test('refuses to delete the actor\'s own account', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ id: 'admin-1' }), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(service.deleteUser(undefined, user({ id: 'admin-1' }), 'admin-1'), /own account/);
	});

	test('rejects an unknown target', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		await assert.rejects(service.deleteUser(undefined, user({ id: 'admin-1' }), 'nobody'), /not found/);
	});

	test('reports the last-admin refusal from the cascade', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ id: 'admin-1', is_admin: true }), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(
			service.deleteUser(undefined, user({ id: 'other' }), 'admin-1'),
			/Keep at least one admin/
		);
	});

	test('purges every reported R2 key on success', async () => {
		const { repo, addUser } = fakeRepo({
			async deleteUserCascade() {
				return { succeeded: true, storageKeys: ['att/one', 'att/two'] };
			}
		});
		addUser({ ...user({ id: 'target' }), passwordHash: 'h' });
		const deleted: string[] = [];
		const service = createAuthService(repo);

		await service.deleteUser(bucket(deleted), user({ id: 'admin-1' }), 'target');
		assert.deepEqual(deleted.sort(), ['att/one', 'att/two']);
	});

	test('still succeeds when an R2 delete fails, and purges the rest', async () => {
		const { repo, addUser } = fakeRepo({
			async deleteUserCascade() {
				return { succeeded: true, storageKeys: ['att/one', 'att/two'] };
			}
		});
		addUser({ ...user({ id: 'target' }), passwordHash: 'h' });
		const deleted: string[] = [];
		const service = createAuthService(repo);

		await assert.doesNotReject(() => service.deleteUser(bucket(deleted, 'att/one'), user({ id: 'admin-1' }), 'target'));
		assert.deepEqual(deleted, ['att/two']);
	});

	test('works without a bucket configured', async () => {
		const { repo, addUser } = fakeRepo({
			async deleteUserCascade() {
				return { succeeded: true, storageKeys: ['att/one'] };
			}
		});
		addUser({ ...user({ id: 'target' }), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.doesNotReject(() => service.deleteUser(undefined, user({ id: 'admin-1' }), 'target'));
	});
});

describe('completeFirstLogin', () => {
	test('validates name and password before touching the repository', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		await assert.rejects(service.completeFirstLogin('u1', { name: '  ', password: 'password123' }), /Name is required/);
		await assert.rejects(service.completeFirstLogin('u1', { name: 'x'.repeat(200), password: 'password123' }), /128 characters/);
		await assert.rejects(service.completeFirstLogin('u1', { name: 'Ada', password: 'short' }), /at least 8/);
		await assert.rejects(service.completeFirstLogin('u1', { name: 'Ada', password: 'x'.repeat(2000) }), /1024 characters/);
	});

	test('refuses once setup is already complete', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ must_change_password: false }), passwordHash: await hashPassword('temp-password') });
		const service = createAuthService(repo);
		await assert.rejects(
			service.completeFirstLogin('user-1', { name: 'Ada', password: 'a-new-password' }),
			/already complete/
		);
	});

	test('refuses to reuse the temporary password', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user({ must_change_password: true }), passwordHash: await hashPassword('temp-password') });
		const service = createAuthService(repo);
		await assert.rejects(
			service.completeFirstLogin('user-1', { name: 'Ada', password: 'temp-password' }),
			/different from the temporary/
		);
	});

	test('sets the new name and password on success', async () => {
		const { repo, addUser, users } = fakeRepo();
		addUser({ ...user({ must_change_password: true }), passwordHash: await hashPassword('temp-password') });
		const service = createAuthService(repo);
		await service.completeFirstLogin('user-1', { name: 'Ada Lovelace', password: 'a-new-password' });
		assert.equal(users.get('user-1')?.name, 'Ada Lovelace');
		assert.equal(users.get('user-1')?.must_change_password, false);
	});
});

describe('recovery tokens', () => {
	test('consumeToken: only the first of two racing redemptions wins', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		const token = await service.createPasswordResetToken('user-1');

		const [first, second] = await Promise.all([
			service.consumeToken('password_reset', token),
			service.consumeToken('password_reset', token)
		]);
		assert.equal([first, second].filter(Boolean).length, 1);
	});

	test('consumeToken rejects the wrong kind or an unknown token', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		const token = await service.startRecoveryEmailChange('user-1', 'new@example.com');
		assert.equal(await service.consumeToken('password_reset', token), null);
		assert.equal(await service.consumeToken('recovery_email', 'not-the-token'), null);
	});

	test('startRecoveryEmailChange validates the address and stores it as pending', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(service.startRecoveryEmailChange('user-1', 'not-an-email'), /valid email/);

		await service.startRecoveryEmailChange('user-1', ' New@Example.com ');
		assert.equal((await service.getRecoveryStatus('user-1')).pending, 'new@example.com');
	});

	test('confirmRecoveryEmail promotes the pending address, once', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		await service.startRecoveryEmailChange('user-1', 'new@example.com');

		assert.equal(await service.confirmRecoveryEmail('user-1'), 'new@example.com');
		assert.equal((await service.getRecoveryStatus('user-1')).email, 'new@example.com');
		assert.equal(await service.confirmRecoveryEmail('user-1'), null);
	});

	test('hasRecentResetToken reflects the cooldown', async () => {
		const { repo } = fakeRepo();
		const service = createAuthService(repo);
		assert.equal(await service.hasRecentResetToken('user-1'), false);
		await service.createPasswordResetToken('user-1');
		assert.equal(await service.hasRecentResetToken('user-1'), true);
	});
});

describe('two-factor', () => {
	test('startEnrollment refuses once already enabled', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		await repo.setPendingTotpSecret('user-1', generateTotpSecret());
		await repo.enableTotp('user-1');

		const service = createAuthService(repo);
		await assert.rejects(service.startEnrollment('user-1', 'ada@example.com', 'Zimail'), /already on/);
	});

	test('confirmEnrollment validates the chain: nothing pending, wrong code, then enables and issues backup codes', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);

		await assert.rejects(service.confirmEnrollment('user-1', '000000'), /Start setup again/);

		const { secret } = await service.startEnrollment('user-1', 'ada@example.com', 'Zimail');
		await assert.rejects(service.confirmEnrollment('user-1', '000000'), /did not match/);

		const backupCodes = await service.confirmEnrollment('user-1', await totpCode(secret));
		assert.equal(backupCodes.length, 10);
		assert.equal(await service.isTwoFactorEnabled('user-1'), true);

		// Confirming again (e.g. a resubmitted form) must not re-enable or reissue codes.
		await assert.rejects(service.confirmEnrollment('user-1', await totpCode(secret)), /already on/);
	});

	test('verifyChallenge falls back to a backup code, burned on use, only once', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		await repo.setPendingTotpSecret('user-1', generateTotpSecret());
		await repo.enableTotp('user-1');
		const service = createAuthService(repo);

		const codes = await service.issueBackupCodes('user-1');
		const code = codes[0];

		assert.equal(await service.verifyChallenge('user-1', code), true);
		assert.equal(await service.verifyChallenge('user-1', code), false);
	});

	test('a code typed in a different case/spacing still works', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		await repo.setPendingTotpSecret('user-1', generateTotpSecret());
		await repo.enableTotp('user-1');
		const service = createAuthService(repo);

		const [code] = await service.issueBackupCodes('user-1');
		assert.equal(await service.verifyChallenge('user-1', normalizeBackupCode(code).toLowerCase()), true);
	});

	test('verifyChallenge refuses everything while two-factor is off', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		assert.equal(await service.verifyChallenge('user-1', 'ABCD-EFGH'), false);
	});

	test('disableTwoFactor clears the secret and every backup code', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		await repo.setPendingTotpSecret('user-1', generateTotpSecret());
		await repo.enableTotp('user-1');
		await repo.replaceBackupCodes('user-1', [await hashToken('x')]);

		const service = createAuthService(repo);
		await service.disableTwoFactor('user-1');
		assert.equal(await service.isTwoFactorEnabled('user-1'), false);
		assert.equal((await service.getTwoFactorStatus('user-1')).backupCodesRemaining, 0);
	});
});

describe('profile settings', () => {
	test('updateEmailSignature normalizes before saving', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		const saved = await service.updateEmailSignature('user-1', '  Cheers,\nAda  ');
		assert.equal(await service.getEmailSignature('user-1'), saved);
	});

	test('setUserUiTheme rejects a malformed theme id', async () => {
		// isThemeId is a shape check (lowercase/digits/hyphen), not a check
		// against the registered theme list — matching the original ui-theme.ts.
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		await assert.rejects(service.setUserUiTheme('user-1', 'Not A Valid Theme!'), /Unknown theme/);
	});

	test('getUserLocale falls back to the default for an unset/unknown value', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		assert.ok(await service.getUserLocale('user-1'));
	});

	test('setUserUiTheme saves a well-formed theme id', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		const saved = await service.setUserUiTheme('user-1', 'zero-dark');
		assert.equal(saved, 'zero-dark');
		assert.equal(await service.getUserUiTheme('user-1'), 'zero-dark');
	});

	test('setUserLocale resolves and saves the locale', async () => {
		const { repo, addUser } = fakeRepo();
		addUser({ ...user(), passwordHash: 'h' });
		const service = createAuthService(repo);
		const saved = await service.setUserLocale('user-1', 'fr');
		assert.equal(await service.getUserLocale('user-1'), saved);
	});
});
