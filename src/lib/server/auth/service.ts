import type { R2Bucket } from '@cloudflare/workers-types';
import type { User } from '$lib/types';
import { MAX_USER_NAME_LENGTH, MIN_PASSWORD_LENGTH } from '$lib/constants';
import { normalizeEmailSignature } from '$lib/email-signature';
import { DEFAULT_UI_THEME, isThemeId } from '$lib/ui-theme/ids';
import { DEFAULT_LOCALE, parseLocale, type Locale } from '$lib/i18n/locales';
import { SESSION_COOKIE, SESSION_DAYS } from '../constants';
import { createSessionToken, hashPassword, hashToken, verifyPassword } from '../util/crypto';
import { generateTotpSecret, matchTotpStep, otpauthUri, verifyTotp } from '../util/totp';
import type { AccountTokenKind, AuthRepository, LockPolicy, LoginGateRow } from './repository';

export { SESSION_COOKIE };

export const PASSWORD_RESET_TTL_MINUTES = 30;
export const RECOVERY_EMAIL_TTL_MINUTES = 60;
/**
 * A fresh reset link is not issued while a recent one is still valid. This is
 * the rate limit: without it, the endpoint is an open relay for mailing someone
 * repeatedly, since anyone can name any address.
 */
export const RESET_RESEND_COOLDOWN_MINUTES = 2;

export const BACKUP_CODE_COUNT = 10;
/** Crockford-ish: no I, L, O, U, so a written-down code cannot be misread. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export type RecoveryStatus = {
	/** Verified and in use. */
	email: string | null;
	/** Saved but still waiting on a click. */
	pending: string | null;
	verifiedAt: string | null;
};

export type TwoFactorStatus = {
	enabled: boolean;
	enabledAt: string | null;
	/** Recovery codes still unused. Zero means the next lost phone is a lockout. */
	backupCodesRemaining: number;
};

/**
 * Ten wrong passwords lock an account for a minute; each failure after that
 * doubles the lock, up to an hour. A wrong second factor weighs double, so
 * five of them lock it: a six-digit code is far easier to guess than a password.
 */
export const LOGIN_LOCK_POLICY: LockPolicy = { threshold: 10, baseLockMs: 60_000, maxLockMs: 60 * 60_000 };
export const PASSWORD_FAILURE_WEIGHT = 1;
export const SECOND_FACTOR_FAILURE_WEIGHT = 2;

/**
 * Checked against when the email is unknown, so that answer takes as long as
 * a wrong password. All-zero salt and hash: the same PBKDF2 work, and nothing
 * can match it.
 */
const DUMMY_PASSWORD_HASH = `${'A'.repeat(22)}==:${'A'.repeat(43)}=`;

export type LoginResult =
	| { ok: true; user: User; token: string }
	| { ok: false; reason: 'invalid' | 'totp_required' | 'totp_invalid' }
	| { ok: false; reason: 'locked'; retryAfterSeconds: number };

export type AuthServiceOptions = { now?: () => number };

/**
 * Not a full validator — just a shape check. Written without nested
 * quantifiers over the same character class (the naive regex backtracks
 * super-linearly on malicious input, since `.` is itself a valid character
 * in `[^\s@]+`).
 */
export function isLikelyEmail(value: string): boolean {
	const trimmed = value.trim();
	const at = trimmed.indexOf('@');
	if (at <= 0 || trimmed.slice(at + 1).includes('@')) return false;

	const local = trimmed.slice(0, at);
	const domain = trimmed.slice(at + 1);
	if (!domain || /\s/.test(local) || /\s/.test(domain)) return false;

	const dot = domain.indexOf('.');
	return dot > 0 && dot < domain.length - 1;
}

export function normalizeBackupCode(code: string): string {
	return code.replace(/[\s-]/g, '').toUpperCase();
}

export function sessionCookieOptions(maxAgeSeconds: number) {
	return {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax' as const,
		maxAge: maxAgeSeconds
	};
}

export function readSessionToken(cookies: { get: (name: string) => string | undefined }): string | undefined {
	return cookies.get(SESSION_COOKIE);
}

/**
 * `byte % CODE_ALPHABET.length` would bias low indices, since 256 is not a
 * multiple of the alphabet's length — rejection sampling keeps every
 * character equally likely.
 */
function randomAlphabetChar(): string {
	const rejectAt = 256 - (256 % CODE_ALPHABET.length);
	let byte: number;
	do {
		byte = crypto.getRandomValues(new Uint8Array(1))[0];
	} while (byte >= rejectAt);
	return CODE_ALPHABET[byte % CODE_ALPHABET.length];
}

function newBackupCode(): string {
	const code = Array.from({ length: CODE_LENGTH }, randomAlphabetChar).join('');
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function expiryFrom(minutes: number): string {
	return new Date(Date.now() + minutes * 60_000).toISOString();
}

export type AuthService = {
	countUsers(): Promise<number>;
	getUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;
	getUserById(id: string): Promise<User | null>;
	listUsers(): Promise<User[]>;
	createUser(input: {
		email: string;
		name: string;
		password: string;
		isAdmin?: boolean;
		mustChangePassword?: boolean;
	}): Promise<User>;
	bootstrapAdmin(input: { email: string; name: string; password: string }): Promise<User>;
	startSession(user: User): Promise<{ user: User; token: string }>;
	login(email: string, password: string, code?: string): Promise<LoginResult>;
	logout(token: string): Promise<void>;
	setUserPassword(userId: string, password: string): Promise<void>;
	setUserName(userId: string, name: string): Promise<User>;
	setUserAdmin(actor: User, targetId: string, isAdmin: boolean): Promise<void>;
	deleteUser(bucket: R2Bucket | undefined, actor: User, targetId: string): Promise<void>;
	deletePendingUser(userId: string): Promise<void>;
	completeFirstLogin(userId: string, input: { name: string; password: string }): Promise<void>;
	getUserFromSession(token: string | undefined): Promise<User | null>;

	getRecoveryStatus(userId: string): Promise<RecoveryStatus>;
	consumeToken(kind: AccountTokenKind, token: string): Promise<string | null>;
	hasRecentResetToken(userId: string): Promise<boolean>;
	createPasswordResetToken(userId: string): Promise<string>;
	startRecoveryEmailChange(userId: string, email: string): Promise<string>;
	confirmRecoveryEmail(userId: string): Promise<string | null>;
	clearRecoveryEmail(userId: string): Promise<void>;
	findResetTarget(email: string): Promise<{ userId: string; recoveryEmail: string } | null>;

	getTwoFactorStatus(userId: string): Promise<TwoFactorStatus>;
	isTwoFactorEnabled(userId: string): Promise<boolean>;
	startEnrollment(userId: string, accountEmail: string, issuer: string): Promise<{ secret: string; uri: string }>;
	issueBackupCodes(userId: string): Promise<string[]>;
	confirmEnrollment(userId: string, code: string): Promise<string[]>;
	disableTwoFactor(userId: string): Promise<void>;
	verifyChallenge(userId: string, code: string): Promise<boolean>;

	getEmailSignature(userId: string): Promise<string>;
	updateEmailSignature(userId: string, value: string): Promise<string>;
	getUserUiTheme(userId: string): Promise<string>;
	setUserUiTheme(userId: string, theme: string): Promise<string>;
	getUserLocale(userId: string): Promise<Locale>;
	setUserLocale(userId: string, locale: string): Promise<Locale>;
};

function lockedFor(lockedUntil: number | null, nowMs: number): LoginResult | null {
	if (lockedUntil === null || lockedUntil <= nowMs) return null;
	return { ok: false, reason: 'locked', retryAfterSeconds: Math.ceil((lockedUntil - nowMs) / 1000) };
}

export function createAuthService(repo: AuthRepository, { now = Date.now }: AuthServiceOptions = {}): AuthService {
	/** Counts the failure; once it locks the account, the caller learns that instead of `reason`. */
	async function fail(userId: string, weight: number, reason: 'invalid' | 'totp_invalid'): Promise<LoginResult> {
		const nowMs = now();
		const lockedUntil = await repo.recordLoginFailure(userId, weight, nowMs, LOGIN_LOCK_POLICY);
		return lockedFor(lockedUntil, nowMs) ?? { ok: false, reason };
	}

	async function startSession(user: User): Promise<{ user: User; token: string }> {
		const token = createSessionToken();
		const tokenHash = await hashToken(token);
		const sessionId = crypto.randomUUID();
		const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

		await repo.insertSession(sessionId, user.id, tokenHash, expiresAt);
		return { user, token };
	}

	async function createUser(input: {
		email: string;
		name: string;
		password: string;
		isAdmin?: boolean;
		mustChangePassword?: boolean;
	}): Promise<User> {
		// This is a login identity only. Mail identities live in `addresses` and are
		// bound to connected Resend domains, so an operator can sign in with any
		// address they control while sending as name@their-resend-domain.
		const email = input.email.toLowerCase().trim();
		if (!isLikelyEmail(email)) {
			throw new Error('Enter a valid email address');
		}

		const existing = await repo.getUserByEmail(email);
		if (existing) {
			throw new Error('An account with that email already exists');
		}

		const id = crypto.randomUUID();
		const passwordHash = await hashPassword(input.password);

		await repo.insertUser({
			id,
			email,
			name: input.name.trim(),
			passwordHash,
			isAdmin: input.isAdmin ?? false,
			mustChangePassword: input.mustChangePassword ?? false
		});

		const user = await repo.getUserById(id);
		if (!user) throw new Error('Failed to create user');
		return user;
	}

	/** Issues a token for `kind`, one live token at a time — a new link silently retires the old one. */
	async function issueToken(userId: string, kind: AccountTokenKind, ttlMinutes: number): Promise<string> {
		const token = createSessionToken();
		await repo.replaceAccountToken(userId, kind, await hashToken(token), expiryFrom(ttlMinutes));
		return token;
	}

	/** Replaces any existing codes. Returned in the clear exactly once. */
	async function issueBackupCodes(userId: string): Promise<string[]> {
		const codes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
		const hashed = await Promise.all(codes.map((code) => hashToken(normalizeBackupCode(code))));
		await repo.replaceBackupCodes(userId, hashed);
		return codes;
	}

	return {
		countUsers: () => repo.countUsers(),
		getUserByEmail: (email) => repo.getUserByEmail(email),
		getUserById: (id) => repo.getUserById(id),
		listUsers: () => repo.listUsers(),
		createUser,

		async bootstrapAdmin(input) {
			const existing = await repo.countUsers();
			if (existing > 0) {
				throw new Error('Setup already completed');
			}
			return createUser({ ...input, isAdmin: true });
		},

		startSession,

		/**
		 * Password first, then the second factor if the account has one.
		 *
		 * No session exists until both pass, so a correct password on its own buys
		 * an attacker nothing. A locked account is refused before the password is
		 * checked, so the refusal says nothing about it. Nothing is written unless
		 * something failed, now or since the last success.
		 */
		async login(email, password, code) {
			const account = await repo.findLoginAccount(email);
			if (!account) {
				await verifyPassword(password, DUMMY_PASSWORD_HASH);
				return { ok: false, reason: 'invalid' };
			}

			const locked = lockedFor(account.lockedUntil, now());
			if (locked) return locked;

			const { user } = account;
			if (!(await verifyPassword(password, account.passwordHash))) {
				return fail(user.id, PASSWORD_FAILURE_WEIGHT, 'invalid');
			}

			// Read again: failures racing this request may have locked the account
			// while the password was being checked.
			const gate = await repo.readLoginGate(user.id);
			if (!gate) return { ok: false, reason: 'invalid' };
			const lockedNow = lockedFor(gate.lockedUntil, now());
			if (lockedNow) return lockedNow;

			if (gate.totpEnabled && gate.totpSecret) {
				if (!code?.trim()) return { ok: false, reason: 'totp_required' };
				if (!(await passSecondFactor(repo, user.id, gate, code, now()))) {
					return fail(user.id, SECOND_FACTOR_FAILURE_WEIGHT, 'totp_invalid');
				}
			}

			if (gate.failedLogins > 0 || gate.lockedUntil !== null) {
				await repo.clearLoginFailures(user.id);
			}

			return { ok: true, ...(await startSession(user)) };
		},

		async logout(token) {
			await repo.deleteSessionByTokenHash(await hashToken(token));
		},

		async setUserPassword(userId, password) {
			if (password.length < MIN_PASSWORD_LENGTH) {
				throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
			}

			const passwordHash = await hashPassword(password);
			const changed = await repo.updatePasswordHash(userId, passwordHash);
			if (!changed) {
				throw new Error('User not found');
			}

			// Password rotation must cut off every login path, including long-lived keys.
			await repo.cutSessionsAndTokens(userId);
		},

		/** Rename a login identity. Mail identities carry their own display names. */
		async setUserName(userId, name) {
			const trimmed = name.trim();
			if (!trimmed) {
				throw new Error('Name cannot be empty');
			}
			if (trimmed.length > MAX_USER_NAME_LENGTH) {
				throw new Error(`Name must be ${MAX_USER_NAME_LENGTH} characters or fewer`);
			}

			const changed = await repo.updateName(userId, trimmed);
			if (!changed) {
				throw new Error('User not found');
			}

			const user = await repo.getUserById(userId);
			if (!user) throw new Error('User not found');
			return user;
		},

		/**
		 * Grant or withdraw admin.
		 *
		 * Promotion needs no guard. Demotion does: the count travels with the
		 * repository's UPDATE rather than being read first, so two admins demoting
		 * each other concurrently cannot both pass a stale check and leave the
		 * instance with nobody. Demoting someone who is already not an admin is a
		 * no-op that still reports success.
		 */
		async setUserAdmin(actor, targetId, isAdmin) {
			if (actor.id === targetId) {
				throw new Error('You cannot change your own role');
			}

			const target = await repo.getUserById(targetId);
			if (!target) {
				throw new Error('User not found');
			}

			if (isAdmin) {
				await repo.promoteAdmin(targetId);
				return;
			}

			const changed = await repo.demoteAdminGuarded(targetId);
			if (!changed) {
				throw new Error('Keep at least one admin');
			}
		},

		/**
		 * Removes the account and everything the D1 cascade takes with it —
		 * sessions, addresses, mail — plus the R2 objects the mail's attachments
		 * point at, which the cascade cannot reach.
		 */
		async deleteUser(bucket, actor, targetId) {
			if (actor.id === targetId) {
				throw new Error('You cannot delete your own account');
			}

			const target = await repo.getUserById(targetId);
			if (!target) {
				throw new Error('User not found');
			}

			const { succeeded, storageKeys } = await repo.deleteUserCascade(targetId);
			if (!succeeded) {
				throw new Error('Keep at least one admin');
			}

			// Purged only after the row is gone, so a refused delete never strands
			// mail without the files it references. Best-effort from here: the
			// account is already deleted, so a storage hiccup must not report
			// failure — log it instead.
			if (bucket && storageKeys.length > 0) {
				const purged = await Promise.allSettled(storageKeys.map((key) => bucket.delete(key)));
				purged.forEach((outcome, index) => {
					if (outcome.status === 'rejected') {
						console.error('Failed to delete attachment object', storageKeys[index], outcome.reason);
					}
				});
			}
		},

		deletePendingUser: (userId) => repo.deletePendingUser(userId),

		async completeFirstLogin(userId, input) {
			const name = input.name.trim();
			if (!name) {
				throw new Error('Name is required');
			}
			if (name.length > 128) {
				throw new Error('Name must be 128 characters or fewer');
			}
			if (input.password.length < 8 || input.password.length > 1024) {
				if (input.password.length > 1024) {
					throw new Error('Password must be 1024 characters or fewer');
				}
				throw new Error('Password must be at least 8 characters');
			}

			const currentHash = await repo.getPasswordHashForFirstLogin(userId);
			if (!currentHash) {
				throw new Error('Account setup is already complete');
			}
			if (await verifyPassword(input.password, currentHash)) {
				throw new Error('Choose a password different from the temporary password');
			}

			const passwordHash = await hashPassword(input.password);
			const changed = await repo.completeFirstLoginRow(userId, name, passwordHash);
			if (!changed) {
				throw new Error('Account setup is already complete');
			}
		},

		async getUserFromSession(token) {
			if (!token) return null;
			return repo.getUserFromSessionByTokenHash(await hashToken(token));
		},

		getRecoveryStatus: (userId) => repo.getRecoveryStatus(userId),

		/** Spends a token if it is live, returning the user it belongs to. */
		async consumeToken(kind, token) {
			const found = await repo.findLiveToken(kind, await hashToken(token), new Date().toISOString());
			if (!found) return null;

			// Conditioned on still being unused, so two clicks cannot both succeed.
			const spent = await repo.markTokenUsed(found.id);
			return spent ? found.userId : null;
		},

		/** True while a recent reset link should still be arriving. */
		async hasRecentResetToken(userId) {
			const cutoff = new Date(Date.now() - RESET_RESEND_COOLDOWN_MINUTES * 60_000).toISOString();
			return repo.hasRecentToken(userId, 'password_reset', cutoff);
		},

		createPasswordResetToken: (userId) => issueToken(userId, 'password_reset', PASSWORD_RESET_TTL_MINUTES),

		/** Stores the address as pending and returns the token to mail to it. */
		async startRecoveryEmailChange(userId, email) {
			const clean = email.trim().toLowerCase();
			if (!isLikelyEmail(clean)) {
				throw new Error('Enter a valid email address');
			}

			await repo.setPendingRecoveryEmail(userId, clean);
			return issueToken(userId, 'recovery_email', RECOVERY_EMAIL_TTL_MINUTES);
		},

		/** Promotes the pending address once its link is clicked. */
		async confirmRecoveryEmail(userId) {
			const pending = await repo.getPendingRecoveryEmail(userId);
			if (!pending) return null;

			await repo.promoteRecoveryEmail(userId, pending);
			return pending;
		},

		clearRecoveryEmail: (userId) => repo.clearRecoveryEmailRow(userId),
		findResetTarget: (email) => repo.findResetTarget(email.trim().toLowerCase()),

		async getTwoFactorStatus(userId) {
			const [status, remaining] = await Promise.all([
				repo.getTwoFactorStatusRow(userId),
				repo.countUnusedBackupCodes(userId)
			]);
			return { enabled: status.enabled, enabledAt: status.enabledAt, backupCodesRemaining: remaining };
		},

		isTwoFactorEnabled: (userId) => isTwoFactorEnabledInternal(repo, userId),

		/**
		 * Mints a fresh secret and parks it unconfirmed.
		 *
		 * Re-enrolling overwrites any half-finished attempt, which is what makes
		 * the "scanned the wrong thing, start over" path work. An enabled account
		 * is left alone — turning 2FA off is an explicit, password-checked action.
		 */
		async startEnrollment(userId, accountEmail, issuer) {
			if (await isTwoFactorEnabledInternal(repo, userId)) {
				throw new Error('Two-factor authentication is already on');
			}

			const secret = generateTotpSecret();
			await repo.setPendingTotpSecret(userId, secret);
			return { secret, uri: otpauthUri(secret, accountEmail, issuer) };
		},

		issueBackupCodes,

		/**
		 * Confirms enrolment with a code from the app, which proves the secret was
		 * actually stored somewhere before it starts gating logins.
		 */
		async confirmEnrollment(userId, code) {
			const row = await repo.readTotp(userId);
			if (!row?.secret) {
				throw new Error('Start setup again — there is nothing to confirm');
			}
			if (row.enabled) {
				throw new Error('Two-factor authentication is already on');
			}
			if (!(await verifyTotp(row.secret, code))) {
				throw new Error('That code did not match. Check your authenticator and try again.');
			}

			await repo.enableTotp(userId);
			return issueBackupCodes(userId);
		},

		disableTwoFactor: (userId) => repo.disableTotpCascade(userId),

		async verifyChallenge(userId, code) {
			const gate = await repo.readLoginGate(userId);
			if (!gate?.totpEnabled || !gate.totpSecret) return false;
			return passSecondFactor(repo, userId, gate, code, now());
		},

		async getEmailSignature(userId) {
			return repo.getEmailSignature(userId);
		},
		async updateEmailSignature(userId, value) {
			const signature = normalizeEmailSignature(value);
			await repo.setEmailSignature(userId, signature);
			return signature;
		},

		async getUserUiTheme(userId) {
			const theme = await repo.getUiTheme(userId);
			return isThemeId(theme) ? theme : DEFAULT_UI_THEME;
		},
		async setUserUiTheme(userId, theme) {
			if (!isThemeId(theme)) {
				throw new Error('Unknown theme');
			}
			await repo.setUiTheme(userId, theme);
			return theme;
		},

		async getUserLocale(userId) {
			const locale = await repo.getLocale(userId);
			return parseLocale(locale ?? DEFAULT_LOCALE);
		},
		async setUserLocale(userId, locale) {
			const resolved = parseLocale(locale);
			await repo.setLocale(userId, resolved);
			return resolved;
		}
	};
}

/**
 * True once the user has finished enrolling — the only state login should
 * gate on. Standalone (not a closure method) so `login` can call it before
 * the returned service object exists.
 */
async function isTwoFactorEnabledInternal(repo: AuthRepository, userId: string): Promise<boolean> {
	const row = await repo.readTotp(userId);
	return Boolean(row?.enabled && row.secret);
}

/**
 * Checks a login challenge against the authenticator, then the recovery codes.
 *
 * Both are single use. An authenticator code is refused once its time step,
 * or a later one, has been accepted; a backup code is burned. Either way a
 * code read off a screenshot or a shoulder cannot be replayed.
 */
async function passSecondFactor(
	repo: AuthRepository,
	userId: string,
	gate: LoginGateRow,
	code: string,
	nowMs: number
): Promise<boolean> {
	if (!gate.totpSecret) return false;

	const step = await matchTotpStep(gate.totpSecret, code, { atMs: nowMs });
	const fresh = step !== null && (gate.totpLastStep === null || step > gate.totpLastStep);
	// Conditioned on the step still being newer, so two racing logins cannot both spend it.
	if (fresh && (await repo.claimTotpStep(userId, step))) return true;

	const match = await repo.findBackupCodeByHash(userId, await hashToken(normalizeBackupCode(code)));
	if (!match) return false;

	// Conditioned on still being unused, so two racing logins cannot both spend
	// the same code.
	return repo.markBackupCodeUsed(match.id);
}
