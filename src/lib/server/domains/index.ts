import type { D1Database } from '@cloudflare/workers-types';
import { getEmailProvider } from '../context';
import { createD1DomainsRepository } from './repository';
import { createDomainsService, type DomainsService } from './service';

export type { DomainsRepository, UnroutedEmail } from './repository';
export {
	createDomainsService,
	DomainsServiceError,
	type DomainsService,
	type CreateAddressInput,
	type DomainsServiceErrorCode,
	type AddressUpdate,
	type InboundRoute
} from './service';
export { createD1DomainsRepository } from './repository';

type PlatformLike = App.Platform | undefined | null;

/** Composition root for routes — mirrors `getEmailProvider` in `../context`. */
export function getDomainsService(platform: PlatformLike): DomainsService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return createDomainsService({
		repo: createD1DomainsRepository(db),
		getProvider: () => getEmailProvider(platform)
	});
}

/*
 * The functions below exist only for the handful of peer server modules
 * (outbox, inbound processing, scheduled-send, security-notice) that receive
 * a `db` handed down from their own callers rather than `platform`, and only
 * need a couple of read/business-rule methods with no provider dependency.
 * They are a deliberately thin, `db`-first facade over the service so those
 * modules don't need their own migration to prove this pattern — routes are
 * the actual target of the "no direct DB access in a route file" rule.
 */

function serviceForDb(db: D1Database): DomainsService {
	return createDomainsService({ repo: createD1DomainsRepository(db) });
}

export function listAddressesForUser(db: D1Database, userId: string) {
	return serviceForDb(db).listAddressesForUser(userId);
}

export function getAddressForUser(db: D1Database, userId: string, addressId: string) {
	return serviceForDb(db).getAddressForUser(userId, addressId);
}

export function getDefaultAddress(db: D1Database, userId: string) {
	return serviceForDb(db).getDefaultAddress(userId);
}

export function getDomainByName(db: D1Database, name: string) {
	return createD1DomainsRepository(db).getDomainByName(name);
}

export function resolveInboundRoute(db: D1Database, recipients: string[]) {
	return serviceForDb(db).resolveInboundRoute(recipients);
}

export function recordUnroutedEmail(db: D1Database, input: Parameters<DomainsService['recordUnroutedEmail']>[0]) {
	return serviceForDb(db).recordUnroutedEmail(input);
}
