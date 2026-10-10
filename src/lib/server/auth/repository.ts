import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '$lib/types';

type UserRow = {
	id: string;
	email: string;
	name: string;
	is_admin: number;
	must_change_password: number;
	created_at: string;
	email_signature?: string;
};

function mapUser(row: UserRow): User {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		is_admin: row.is_admin === 1,
		must_change_password: row.must_change_password === 1,
		created_at: row.created_at,
		...(row.email_signature === undefined ? {} : { email_signature: row.email_signature })
	};
}

export type NewUser = {
	id: string;
	email: string;
	name: string;
	passwordHash: string;
	isAdmin: boolean;
	mustChangePassword: boolean;
};

export type AccountTokenKind = 'password_reset' | 'recovery_email';

export type RecoveryStatusRow = {
	email: string | null;
	pending: string | null;
	verifiedAt: string | null;
};

export type TwoFactorStatusRow = {
	enabled: boolean;
	enabledAt: string | null;
};

export type LoginAccount = {
	user: User;
	passwordHash: string;
	/** Epoch ms. */
	lockedUntil: number | null;
};

/** What the second half of a sign-in needs, read fresh after the password check. */
export type LoginGateRow = {
	failedLogins: number;
	lockedUntil: number | null;
	totpSecret: string | null;
	totpEnabled: boolean;
	totpLastStep: number | null;
};

export type LockPolicy = {
	/** Failure weight at which the account locks. */
	threshold: number;
	baseLockMs: number;
	maxLockMs: number;
};

/**
 * Raw D1 (+ R2, for the user-delete cascade) access for identity: users,
 * sessions, account_tokens, totp_backup_codes. No business rules — see
 * `./service.ts` for those. Every atomic `db.batch(...)` from the original
 * files stays exactly one method here: the atomicity is a security property
 * (the last-admin guard, the password-rotation cutoff, the delete cascade),
 * not something a service should be allowed to split into separate calls.
 */
export type AuthRepository = {
	countUsers(): Promise<number>;
	getUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
	getUserById(id: string): Promise<User | null>;
	listUsers(): Promise<User[]>;
	insertUser(user: NewUser): Promise<void>;
	updatePasswordHash(userId: string, passwordHash: string): Promise<boolean>;
	/** Password rotation must cut off every login path, including long-lived keys. */
	cutSessionsAndTokens(userId: string): Promise<void>;
	updateName(userId: string, name: string): Promise<boolean>;
	promoteAdmin(userId: string): Promise<void>;
	/** Atomic: refuses if `userId` is the last admin, in the same statement as the demote. */
	demoteAdminGuarded(userId: string): Promise<boolean>;
	/** The whole delete cascade in one batch. Returns the attachment storage keys to purge from R2. */
	deleteUserCascade(targetId: string): Promise<{ succeeded: boolean; storageKeys: string[] }>;
	deletePendingUser(userId: string): Promise<void>;
	getPasswordHashForFirstLogin(userId: string): Promise<string | null>;
	/** The name+password+must_change_password update, cutting sessions/tokens in the same batch. */
	completeFirstLoginRow(userId: string, name: string, passwordHash: string): Promise<boolean>;
	getUserFromSessionByTokenHash(tokenHash: string): Promise<User | null>;
	insertSession(sessionId: string, userId: string, tokenHash: string, expiresAt: string): Promise<void>;
	deleteSessionByTokenHash(tokenHash: string): Promise<void>;

	getRecoveryStatus(userId: string): Promise<RecoveryStatusRow>;
	/** Deletes any live token of this kind and inserts the new one, atomically. */
	replaceAccountToken(
		userId: string,
		kind: AccountTokenKind,
		tokenHash: string,
		expiresAt: string
	): Promise<void>;
	findLiveToken(
		kind: AccountTokenKind,
		tokenHash: string,
		now: string
	): Promise<{ id: string; userId: string } | null>;
	markTokenUsed(id: string): Promise<boolean>;
	hasRecentToken(userId: string, kind: AccountTokenKind, cutoff: string): Promise<boolean>;
	setPendingRecoveryEmail(userId: string, email: string): Promise<void>;
	getPendingRecoveryEmail(userId: string): Promise<string | null>;
	promoteRecoveryEmail(userId: string, email: string): Promise<void>;
	/** Clears the recovery columns and deletes any live recovery_email token, atomically. */
	clearRecoveryEmailRow(userId: string): Promise<void>;
	findResetTarget(email: string): Promise<{ userId: string; recoveryEmail: string } | null>;

	readTotp(userId: string): Promise<{ secret: string | null; enabled: boolean } | null>;
	getTwoFactorStatusRow(userId: string): Promise<TwoFactorStatusRow>;
	countUnusedBackupCodes(userId: string): Promise<number>;
	setPendingTotpSecret(userId: string, secret: string): Promise<void>;
	/** Deletes any existing codes and inserts the new set, atomically. */
	replaceBackupCodes(userId: string, hashedCodes: string[]): Promise<void>;
	enableTotp(userId: string): Promise<void>;
	/** Clears the secret/flag and deletes backup codes, atomically. */
	disableTotpCascade(userId: string): Promise<void>;
	findBackupCodeByHash(userId: string, codeHash: string): Promise<{ id: string } | null>;
	markBackupCodeUsed(id: string): Promise<boolean>;

	findLoginAccount(email: string): Promise<LoginAccount | null>;
	readLoginGate(userId: string): Promise<LoginGateRow | null>;
	/**
	 * Adds `weight` to the failure count and, once it reaches the threshold,
	 * locks for `baseLockMs` doubled per failure past it, capped at `maxLockMs`.
	 * One UPDATE, so concurrent failures cannot lose a count. Returns the lock.
	 */
	recordLoginFailure(userId: string, weight: number, nowMs: number, policy: LockPolicy): Promise<number | null>;
	clearLoginFailures(userId: string): Promise<void>;
	/** Stores `step` only if it is newer than the last accepted one. False means a replay. */
	claimTotpStep(userId: string, step: number): Promise<boolean>;

	getEmailSignature(userId: string): Promise<string>;
	setEmailSignature(userId: string, value: string): Promise<void>;
	getUiTheme(userId: string): Promise<string | null>;
	setUiTheme(userId: string, theme: string): Promise<void>;
	getLocale(userId: string): Promise<string | null>;
	setLocale(userId: string, locale: string): Promise<void>;
};

export function createD1AuthRepository(db: D1Database): AuthRepository {
	return {
		async countUsers() {
			const row = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
			return row?.count ?? 0;
		},

		async getUserByEmail(email) {
			const row = await db
				.prepare(
					'SELECT id, email, name, password_hash, is_admin, must_change_password, created_at FROM users WHERE email = ?'
				)
				.bind(email.toLowerCase())
				.first<UserRow & { password_hash: string }>();
			return row ? { ...mapUser(row), passwordHash: row.password_hash } : null;
		},

		async getUserById(id) {
			const row = await db
				.prepare('SELECT id, email, name, is_admin, must_change_password, created_at FROM users WHERE id = ?')
				.bind(id)
				.first<UserRow>();
			return row ? mapUser(row) : null;
		},

		async listUsers() {
			const { results } = await db
				.prepare(
					'SELECT id, email, name, is_admin, must_change_password, created_at FROM users ORDER BY created_at ASC'
				)
				.all<UserRow>();
			return results.map(mapUser);
		},

		async insertUser(user) {
			await db
				.prepare(
					`INSERT INTO users
					 (id, email, name, password_hash, is_admin, must_change_password)
					 VALUES (?, ?, ?, ?, ?, ?)`
				)
				.bind(
					user.id,
					user.email,
					user.name,
					user.passwordHash,
					user.isAdmin ? 1 : 0,
					user.mustChangePassword ? 1 : 0
				)
				.run();
		},

		async updatePasswordHash(userId, passwordHash) {
			const result = await db
				.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
				.bind(passwordHash, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async cutSessionsAndTokens(userId) {
			await db.batch([
				db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
				db.prepare('DELETE FROM api_tokens WHERE user_id = ?').bind(userId)
			]);
		},

		async updateName(userId, name) {
			const result = await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, userId).run();
			return (result.meta.changes ?? 0) > 0;
		},

		async promoteAdmin(userId) {
			await db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(userId).run();
		},

		async demoteAdminGuarded(userId) {
			const result = await db
				.prepare(
					`UPDATE users SET is_admin = 0
					 WHERE id = ?
					   AND (is_admin = 0 OR (SELECT COUNT(*) FROM users WHERE is_admin = 1) > 1)`
				)
				.bind(userId)
				.run();
			return (result.meta?.changes ?? 0) > 0;
		},

		async deleteUserCascade(targetId) {
			const gone = 'NOT EXISTS (SELECT 1 FROM users WHERE id = ?)';
			const [keys, deletion] = await db.batch<{ storage_key: string }>([
				db
					.prepare(
						`SELECT storage_key FROM email_attachments
						 WHERE storage_key IS NOT NULL
						   AND email_id IN (SELECT id FROM emails WHERE user_id = ?)`
					)
					.bind(targetId),
				db
					.prepare(
						`DELETE FROM users
						 WHERE id = ?
						   AND (is_admin = 0 OR (SELECT COUNT(*) FROM users WHERE is_admin = 1) > 1)`
					)
					.bind(targetId),
				db
					.prepare(
						`DELETE FROM email_attachments
						 WHERE email_id IN (SELECT id FROM emails WHERE user_id = ?) AND ${gone}`
					)
					.bind(targetId, targetId),
				db.prepare(`DELETE FROM emails WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
				db.prepare(`DELETE FROM addresses WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
				db.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
				db.prepare(`DELETE FROM api_tokens WHERE user_id = ? AND ${gone}`).bind(targetId, targetId),
				db
					.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND ${gone}`)
					.bind(targetId, targetId),
				db
					.prepare(`UPDATE domains SET catchall_user_id = NULL WHERE catchall_user_id = ? AND ${gone}`)
					.bind(targetId, targetId)
			]);

			return {
				succeeded: (deletion.meta?.changes ?? 0) > 0,
				storageKeys: (keys.results ?? []).map((row) => row.storage_key)
			};
		},

		async deletePendingUser(userId) {
			await db.prepare('DELETE FROM users WHERE id = ? AND must_change_password = 1').bind(userId).run();
		},

		async getPasswordHashForFirstLogin(userId) {
			const row = await db
				.prepare('SELECT password_hash FROM users WHERE id = ? AND must_change_password = 1')
				.bind(userId)
				.first<{ password_hash: string }>();
			return row?.password_hash ?? null;
		},

		async completeFirstLoginRow(userId, name, passwordHash) {
			const [result] = await db.batch([
				db
					.prepare(
						`UPDATE users
						 SET name = ?, password_hash = ?, must_change_password = 0
						 WHERE id = ? AND must_change_password = 1`
					)
					.bind(name, passwordHash, userId),
				db
					.prepare(
						`DELETE FROM sessions
						 WHERE user_id = ?
						   AND EXISTS (
							SELECT 1 FROM users
							WHERE id = ? AND password_hash = ? AND must_change_password = 0
						   )`
					)
					.bind(userId, userId, passwordHash),
				db
					.prepare(
						`DELETE FROM api_tokens
						 WHERE user_id = ?
						   AND EXISTS (
							SELECT 1 FROM users
							WHERE id = ? AND password_hash = ? AND must_change_password = 0
						   )`
					)
					.bind(userId, userId, passwordHash)
			]);
			return (result.meta.changes ?? 0) > 0;
		},

		async getUserFromSessionByTokenHash(tokenHash) {
			const row = await db
				.prepare(
					`SELECT u.id, u.email, u.name, u.is_admin, u.must_change_password, u.created_at, u.email_signature
					 FROM sessions s
					 JOIN users u ON u.id = s.user_id
					 WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
				)
				.bind(tokenHash)
				.first<UserRow>();
			return row ? mapUser(row) : null;
		},

		async insertSession(sessionId, userId, tokenHash, expiresAt) {
			await db
				.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
				.bind(sessionId, userId, tokenHash, expiresAt)
				.run();
		},

		async deleteSessionByTokenHash(tokenHash) {
			await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
		},

		async getRecoveryStatus(userId) {
			const row = await db
				.prepare(
					'SELECT recovery_email, recovery_email_pending, recovery_email_verified_at FROM users WHERE id = ?'
				)
				.bind(userId)
				.first<{
					recovery_email: string | null;
					recovery_email_pending: string | null;
					recovery_email_verified_at: string | null;
				}>();
			return {
				email: row?.recovery_email ?? null,
				pending: row?.recovery_email_pending ?? null,
				verifiedAt: row?.recovery_email_verified_at ?? null
			};
		},

		async replaceAccountToken(userId, kind, tokenHash, expiresAt) {
			await db.batch([
				db.prepare('DELETE FROM account_tokens WHERE user_id = ? AND kind = ?').bind(userId, kind),
				db
					.prepare(
						'INSERT INTO account_tokens (id, user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)'
					)
					.bind(crypto.randomUUID(), userId, kind, tokenHash, expiresAt)
			]);
		},

		async findLiveToken(kind, tokenHash, now) {
			const row = await db
				.prepare(
					`SELECT id, user_id FROM account_tokens
					  WHERE kind = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?`
				)
				.bind(kind, tokenHash, now)
				.first<{ id: string; user_id: string }>();
			return row ? { id: row.id, userId: row.user_id } : null;
		},

		async markTokenUsed(id) {
			const result = await db
				.prepare("UPDATE account_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL")
				.bind(id)
				.run();
			return (result.meta.changes ?? 0) === 1;
		},

		async hasRecentToken(userId, kind, cutoff) {
			const row = await db
				.prepare(
					`SELECT id FROM account_tokens
					  WHERE user_id = ? AND kind = ? AND used_at IS NULL AND created_at > ?`
				)
				.bind(userId, kind, cutoff)
				.first<{ id: string }>();
			return Boolean(row);
		},

		async setPendingRecoveryEmail(userId, email) {
			await db.prepare('UPDATE users SET recovery_email_pending = ? WHERE id = ?').bind(email, userId).run();
		},

		async getPendingRecoveryEmail(userId) {
			const row = await db
				.prepare('SELECT recovery_email_pending FROM users WHERE id = ?')
				.bind(userId)
				.first<{ recovery_email_pending: string | null }>();
			return row?.recovery_email_pending ?? null;
		},

		async promoteRecoveryEmail(userId, email) {
			await db
				.prepare(
					`UPDATE users
					    SET recovery_email = ?, recovery_email_pending = NULL,
					        recovery_email_verified_at = datetime('now')
					  WHERE id = ?`
				)
				.bind(email, userId)
				.run();
		},

		async clearRecoveryEmailRow(userId) {
			await db.batch([
				db
					.prepare(
						`UPDATE users
						    SET recovery_email = NULL, recovery_email_pending = NULL,
						        recovery_email_verified_at = NULL
						  WHERE id = ?`
					)
					.bind(userId),
				db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND kind = 'recovery_email'").bind(userId)
			]);
		},

		async findResetTarget(email) {
			const row = await db
				.prepare(
					`SELECT id, recovery_email FROM users
					  WHERE email = ? COLLATE NOCASE AND recovery_email IS NOT NULL
					    AND recovery_email_verified_at IS NOT NULL`
				)
				.bind(email)
				.first<{ id: string; recovery_email: string }>();
			return row ? { userId: row.id, recoveryEmail: row.recovery_email } : null;
		},

		async readTotp(userId) {
			const row = await db
				.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?')
				.bind(userId)
				.first<{ totp_secret: string | null; totp_enabled: number }>();
			return row ? { secret: row.totp_secret, enabled: row.totp_enabled === 1 } : null;
		},

		async getTwoFactorStatusRow(userId) {
			const row = await db
				.prepare('SELECT totp_enabled, totp_enabled_at FROM users WHERE id = ?')
				.bind(userId)
				.first<{ totp_enabled: number; totp_enabled_at: string | null }>();
			return { enabled: row?.totp_enabled === 1, enabledAt: row?.totp_enabled_at ?? null };
		},

		async countUnusedBackupCodes(userId) {
			const row = await db
				.prepare('SELECT COUNT(*) AS count FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL')
				.bind(userId)
				.first<{ count: number }>();
			return row?.count ?? 0;
		},

		async setPendingTotpSecret(userId, secret) {
			await db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').bind(secret, userId).run();
		},

		async replaceBackupCodes(userId, hashedCodes) {
			await db.batch([
				db.prepare('DELETE FROM totp_backup_codes WHERE user_id = ?').bind(userId),
				...hashedCodes.map((hash) =>
					db.prepare('INSERT INTO totp_backup_codes (id, user_id, code_hash) VALUES (?, ?, ?)').bind(
						crypto.randomUUID(),
						userId,
						hash
					)
				)
			]);
		},

		async enableTotp(userId) {
			await db
				.prepare("UPDATE users SET totp_enabled = 1, totp_enabled_at = datetime('now') WHERE id = ?")
				.bind(userId)
				.run();
		},

		async disableTotpCascade(userId) {
			await db.batch([
				db
					.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_enabled_at = NULL WHERE id = ?')
					.bind(userId),
				db.prepare('DELETE FROM totp_backup_codes WHERE user_id = ?').bind(userId)
			]);
		},

		async findBackupCodeByHash(userId, codeHash) {
			const row = await db
				.prepare('SELECT id FROM totp_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
				.bind(userId, codeHash)
				.first<{ id: string }>();
			return row ?? null;
		},

		async markBackupCodeUsed(id) {
			const result = await db
				.prepare("UPDATE totp_backup_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL")
				.bind(id)
				.run();
			return (result.meta.changes ?? 0) === 1;
		},

		async findLoginAccount(email) {
			const row = await db
				.prepare(
					`SELECT id, email, name, is_admin, must_change_password, created_at, password_hash, locked_until
					   FROM users WHERE email = ?`
				)
				.bind(email.toLowerCase())
				.first<UserRow & { password_hash: string; locked_until: number | null }>();
			if (!row) return null;
			return { user: mapUser(row), passwordHash: row.password_hash, lockedUntil: row.locked_until };
		},

		async readLoginGate(userId) {
			const row = await db
				.prepare(
					'SELECT failed_logins, locked_until, totp_secret, totp_enabled, totp_last_step FROM users WHERE id = ?'
				)
				.bind(userId)
				.first<{
					failed_logins: number;
					locked_until: number | null;
					totp_secret: string | null;
					totp_enabled: number;
					totp_last_step: number | null;
				}>();
			if (!row) return null;
			return {
				failedLogins: row.failed_logins,
				lockedUntil: row.locked_until,
				totpSecret: row.totp_secret,
				totpEnabled: row.totp_enabled === 1,
				totpLastStep: row.totp_last_step
			};
		},

		async recordLoginFailure(userId, weight, nowMs, policy) {
			// Right-hand sides read the row as it was, so `failed_logins + ?2` is the new count.
			const row = await db
				.prepare(
					`UPDATE users
					    SET failed_logins = failed_logins + ?2,
					        locked_until = CASE
					          WHEN failed_logins + ?2 >= ?3
					          THEN ?4 + min(?6, ?5 << min(failed_logins + ?2 - ?3, 30))
					          ELSE locked_until
					        END
					  WHERE id = ?1
					RETURNING locked_until`
				)
				.bind(userId, weight, policy.threshold, nowMs, policy.baseLockMs, policy.maxLockMs)
				.first<{ locked_until: number | null }>();
			return row?.locked_until ?? null;
		},

		async clearLoginFailures(userId) {
			await db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(userId).run();
		},

		async claimTotpStep(userId, step) {
			const result = await db
				.prepare(
					'UPDATE users SET totp_last_step = ?2 WHERE id = ?1 AND (totp_last_step IS NULL OR totp_last_step < ?2)'
				)
				.bind(userId, step)
				.run();
			return (result.meta.changes ?? 0) === 1;
		},

		async getEmailSignature(userId) {
			const row = await db
				.prepare('SELECT email_signature FROM users WHERE id = ?')
				.bind(userId)
				.first<{ email_signature: string }>();
			return row?.email_signature ?? '';
		},

		async setEmailSignature(userId, value) {
			await db.prepare('UPDATE users SET email_signature = ? WHERE id = ?').bind(value, userId).run();
		},

		async getUiTheme(userId) {
			const row = await db
				.prepare('SELECT ui_theme FROM users WHERE id = ?')
				.bind(userId)
				.first<{ ui_theme: string | null }>();
			return row?.ui_theme ?? null;
		},

		async setUiTheme(userId, theme) {
			await db.prepare('UPDATE users SET ui_theme = ? WHERE id = ?').bind(theme, userId).run();
		},

		async getLocale(userId) {
			const row = await db
				.prepare('SELECT locale FROM users WHERE id = ?')
				.bind(userId)
				.first<{ locale: string | null }>();
			return row?.locale ?? null;
		},

		async setLocale(userId, locale) {
			await db.prepare('UPDATE users SET locale = ? WHERE id = ?').bind(locale, userId).run();
		}
	};
}
