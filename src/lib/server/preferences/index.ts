import type { D1Database } from '@cloudflare/workers-types';
import { createD1PreferencesRepository } from './repository';
import { createPreferencesService, type PreferencesService } from './service';

export type { PreferencesRepository } from './repository';
export { createD1PreferencesRepository } from './repository';
export { createPreferencesService, type PreferencesService } from './service';

type PlatformLike = App.Platform | undefined | null;

/** For peer server modules handed a `db` rather than `platform` (the outbox). */
export function preferencesServiceForDb(db: D1Database): PreferencesService {
	return createPreferencesService(createD1PreferencesRepository(db));
}

/** Composition root for routes and hooks — mirrors `getAuthService`. */
export function getPreferencesService(platform: PlatformLike): PreferencesService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return preferencesServiceForDb(db);
}
