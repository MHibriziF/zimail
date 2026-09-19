import type { D1Database } from '@cloudflare/workers-types';
import { listAddressesForUser } from '../domains';
import { mailStoreServiceForDb } from '../mail-store';
import { createD1CategoriesRepository } from './repository';
import { createCategoriesService, type CategoriesService } from './service';

export { classifyMail, pickClassifyHeaders, type ClassifyInput } from './classify';
export { createCategoriesService, type CategoriesService } from './service';
export { createD1CategoriesRepository, type CategoriesRepository } from './repository';

type PlatformLike = App.Platform | undefined | null;

/** For the inbound paths, which are handed a `db` rather than `platform`. */
export function categoriesServiceForDb(db: D1Database): CategoriesService {
	const mailStore = mailStoreServiceForDb(db);
	return createCategoriesService({
		repo: createD1CategoriesRepository(db),
		expandToThreads: (userId, ids) => mailStore.expandToThreads(userId, ids),
		setCategory: (userId, ids, category) => mailStore.setCategory(userId, ids, category),
		ownAddresses: async (userId) => (await listAddressesForUser(db, userId)).map((address) => address.address)
	});
}

/** Composition root for routes. */
export function getCategoriesService(platform: PlatformLike): CategoriesService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return categoriesServiceForDb(db);
}
