import type { D1Database } from '@cloudflare/workers-types';
import { listAddressesForUser } from '../domains';
import { mailStoreServiceForDb } from '../mail-store';
import { createD1SpamRepository } from './repository';
import { createSpamService, type SpamService } from './service';

export { authenticationFailed } from './authentication';
export { createSpamService, type SpamService } from './service';
export { createD1SpamRepository, type SpamRepository } from './repository';

type PlatformLike = App.Platform | undefined | null;

/** For the inbound paths, which are handed a `db` rather than `platform`. */
export function spamServiceForDb(db: D1Database): SpamService {
	const mailStore = mailStoreServiceForDb(db);
	return createSpamService({
		repo: createD1SpamRepository(db),
		expandToThreads: (userId, ids) => mailStore.expandToThreads(userId, ids),
		setEmailFlags: (userId, ids, update) => mailStore.setEmailFlags(userId, ids, update),
		ownAddresses: async (userId) => (await listAddressesForUser(db, userId)).map((address) => address.address)
	});
}

/**
 * Where a just-stored message actually landed. Not always the verdict passed to
 * insertEmail: a reply follows its conversation into (or out of) Spam.
 */
export async function isFiledAsSpam(db: D1Database, userId: string, emailId: string): Promise<boolean> {
	const email = await mailStoreServiceForDb(db).getEmailForUser(userId, emailId);
	return Boolean(email?.spam_at);
}

/** Composition root for routes. */
export function getSpamService(platform: PlatformLike): SpamService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return spamServiceForDb(db);
}
