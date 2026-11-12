import type { D1Database } from '@cloudflare/workers-types';
import { createD1AuthRepository } from './repository';
import { createAuthService, type AuthService } from './service';

export type { AuthRepository, AccountTokenKind } from './repository';
export {
	createAuthService,
	SESSION_COOKIE,
	PASSWORD_RESET_TTL_MINUTES,
	RECOVERY_EMAIL_TTL_MINUTES,
	RESET_RESEND_COOLDOWN_MINUTES,
	BACKUP_CODE_COUNT,
	isLikelyEmail,
	normalizeBackupCode,
	sessionCookieOptions,
	readSessionToken,
	type AuthService,
	type RecoveryStatus,
	type TwoFactorStatus,
	type LoginResult
} from './service';

type PlatformLike = App.Platform | undefined | null;

/** Composition root for routes — mirrors `getDomainsService`/`getMailStoreService`. */
export function getAuthService(platform: PlatformLike): AuthService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return createAuthService(createD1AuthRepository(db));
}

/*
 * The functions below exist only for the peer server modules (scheduled-send,
 * outbox) that receive a `db` handed down from their own callers rather than
 * `platform`. Deliberately thin, `db`-first facades over the service —
 * routes are the actual target of the "no direct DB access in a route file"
 * rule, not these peer modules.
 */

export function getUserById(db: D1Database, id: string) {
	return createAuthService(createD1AuthRepository(db)).getUserById(id);
}
