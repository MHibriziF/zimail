import type { D1Database } from '@cloudflare/workers-types';
import type { Domain, MailAddress } from '$lib/types';
import type { ProviderDomain } from '../email-provider';

type DomainRow = {
	id: string;
	name: string;
	status: string;
	region: string | null;
	sending_enabled: number;
	receiving_enabled: number;
	catchall_user_id: string | null;
	created_at: string;
	synced_at: string | null;
};

type AddressRow = {
	id: string;
	user_id: string;
	domain_id: string;
	domain_name: string;
	address: string;
	label: string | null;
	is_default: number;
	signature: string | null;
	created_at: string;
};

export type UnroutedEmail = {
	id: string;
	provider_id: string | null;
	from_addr: string;
	to_addr: string;
	subject: string | null;
	reason: string;
	created_at: string;
};

export type NewAddress = {
	id: string;
	userId: string;
	domainId: string;
	address: string;
	label: string | null;
	isDefault: boolean;
};

export type AddressPatch = { label: string | null; signature: string | null };

export type MatchedAddress = { id: string; userId: string; domainId: string; address: string };

export type DomainCatchall = { id: string; catchallUserId: string | null };

export type NewUnroutedEmail = {
	providerId: string | null;
	from: string;
	to: string;
	subject: string | null;
	reason: string;
};

function mapDomain(row: DomainRow): Domain {
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		region: row.region,
		sending_enabled: row.sending_enabled === 1,
		receiving_enabled: row.receiving_enabled === 1,
		catchall_user_id: row.catchall_user_id,
		created_at: row.created_at,
		synced_at: row.synced_at
	};
}

function mapAddress(row: AddressRow): MailAddress {
	return {
		id: row.id,
		user_id: row.user_id,
		domain_id: row.domain_id,
		domain_name: row.domain_name,
		address: row.address,
		label: row.label,
		is_default: row.is_default === 1,
		signature: row.signature,
		created_at: row.created_at
	};
}

const ADDRESS_SELECT = `SELECT a.id, a.user_id, a.domain_id, d.name AS domain_name, a.address,
	a.label, a.is_default, a.signature, a.created_at
	FROM addresses a JOIN domains d ON d.id = a.domain_id`;

/**
 * One module's worth of D1 access for domains/addresses/unrouted mail — no
 * business rules, just query + row mapping. See `../service.ts` for the rules
 * built on top of these primitives.
 */
export type DomainsRepository = {
	listConnected(): Promise<Domain[]>;
	getDomain(id: string): Promise<Domain | null>;
	getDomainByName(name: string): Promise<Domain | null>;
	upsertDomain(domain: ProviderDomain): Promise<Domain>;
	disconnectDomain(id: string): Promise<void>;
	setCatchallUser(domainId: string, userId: string | null): Promise<void>;
	markDomainMissing(id: string): Promise<void>;

	listAddressesForUser(userId: string): Promise<MailAddress[]>;
	listAllAddresses(): Promise<MailAddress[]>;
	getAddressForUser(userId: string, addressId: string): Promise<MailAddress | null>;
	findAddressByValue(address: string): Promise<{ id: string } | null>;
	findAddressesByValues(addresses: string[]): Promise<MatchedAddress[]>;
	findDomainCatchallByName(name: string): Promise<DomainCatchall | null>;
	insertAddress(input: NewAddress): Promise<void>;
	updateAddressRow(userId: string, addressId: string, patch: AddressPatch): Promise<void>;
	setDefaultAddress(userId: string, addressId: string): Promise<void>;
	deleteAddress(userId: string, addressId: string): Promise<void>;

	/** Returns whether a new row was stored — false when this is a retry. */
	recordUnroutedEmail(input: NewUnroutedEmail): Promise<boolean>;
	listUnroutedEmails(limit: number): Promise<UnroutedEmail[]>;
};

export function createD1DomainsRepository(db: D1Database): DomainsRepository {
	return {
		async listConnected() {
			const { results } = await db
				.prepare('SELECT * FROM domains ORDER BY created_at ASC')
				.all<DomainRow>();
			return results.map(mapDomain);
		},

		async getDomain(id) {
			const row = await db
				.prepare('SELECT * FROM domains WHERE id = ?')
				.bind(id)
				.first<DomainRow>();
			return row ? mapDomain(row) : null;
		},

		async getDomainByName(name) {
			const row = await db
				.prepare('SELECT * FROM domains WHERE name = ?')
				.bind(name.toLowerCase())
				.first<DomainRow>();
			return row ? mapDomain(row) : null;
		},

		async upsertDomain(domain) {
			await db
				.prepare(
					`INSERT INTO domains (id, name, status, region, sending_enabled, receiving_enabled, synced_at)
					 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
					 ON CONFLICT(id) DO UPDATE SET
						name = excluded.name,
						status = excluded.status,
						region = excluded.region,
						sending_enabled = excluded.sending_enabled,
						receiving_enabled = excluded.receiving_enabled,
						synced_at = excluded.synced_at`
				)
				.bind(
					domain.id,
					domain.name.toLowerCase(),
					domain.status,
					domain.region ?? null,
					domain.sendingEnabled ? 1 : 0,
					domain.receivingEnabled ? 1 : 0
				)
				.run();

			const row = await db
				.prepare('SELECT * FROM domains WHERE id = ?')
				.bind(domain.id)
				.first<DomainRow>();
			if (!row) throw new Error('Failed to connect domain');
			return mapDomain(row);
		},

		async disconnectDomain(id) {
			await db.prepare('DELETE FROM domains WHERE id = ?').bind(id).run();
		},

		async setCatchallUser(domainId, userId) {
			await db
				.prepare('UPDATE domains SET catchall_user_id = ? WHERE id = ?')
				.bind(userId, domainId)
				.run();
		},

		async markDomainMissing(id) {
			// Removed from the provider — mark it so the UI can explain why sending fails.
			await db
				.prepare(
					`UPDATE domains SET status = 'missing', sending_enabled = 0, receiving_enabled = 0,
					 synced_at = datetime('now') WHERE id = ?`
				)
				.bind(id)
				.run();
		},

		async listAddressesForUser(userId) {
			const { results } = await db
				.prepare(`${ADDRESS_SELECT} WHERE a.user_id = ? ORDER BY a.is_default DESC, a.address ASC`)
				.bind(userId)
				.all<AddressRow>();
			return results.map(mapAddress);
		},

		async listAllAddresses() {
			const { results } = await db
				.prepare(`${ADDRESS_SELECT} ORDER BY d.name ASC, a.address ASC`)
				.all<AddressRow>();
			return results.map(mapAddress);
		},

		async getAddressForUser(userId, addressId) {
			const row = await db
				.prepare(`${ADDRESS_SELECT} WHERE a.id = ? AND a.user_id = ?`)
				.bind(addressId, userId)
				.first<AddressRow>();
			return row ? mapAddress(row) : null;
		},

		async findAddressByValue(address) {
			return db.prepare('SELECT id FROM addresses WHERE address = ?').bind(address).first();
		},

		async findAddressesByValues(addresses) {
			if (addresses.length === 0) return [];
			const placeholders = addresses.map(() => '?').join(', ');
			const { results } = await db
				.prepare(
					`SELECT id, user_id, domain_id, address FROM addresses WHERE address IN (${placeholders})`
				)
				.bind(...addresses)
				.all<{ id: string; user_id: string; domain_id: string; address: string }>();
			return results.map((row) => ({
				id: row.id,
				userId: row.user_id,
				domainId: row.domain_id,
				address: row.address
			}));
		},

		async findDomainCatchallByName(name) {
			const row = await db
				.prepare('SELECT id, catchall_user_id FROM domains WHERE name = ?')
				.bind(name.toLowerCase())
				.first<{ id: string; catchall_user_id: string | null }>();
			return row ? { id: row.id, catchallUserId: row.catchall_user_id } : null;
		},

		async insertAddress(input) {
			await db
				.prepare(
					`INSERT INTO addresses (id, user_id, domain_id, address, label, is_default)
					 VALUES (?, ?, ?, ?, ?, ?)`
				)
				.bind(
					input.id,
					input.userId,
					input.domainId,
					input.address,
					input.label,
					input.isDefault ? 1 : 0
				)
				.run();
		},

		async updateAddressRow(userId, addressId, patch) {
			await db
				.prepare('UPDATE addresses SET label = ?, signature = ? WHERE id = ? AND user_id = ?')
				.bind(patch.label, patch.signature, addressId, userId)
				.run();
		},

		async setDefaultAddress(userId, addressId) {
			await db.batch([
				db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').bind(userId),
				db
					.prepare('UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?')
					.bind(addressId, userId)
			]);
		},

		async deleteAddress(userId, addressId) {
			await db
				.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?')
				.bind(addressId, userId)
				.run();
		},

		async recordUnroutedEmail(input) {
			// A retried delivery must not pile up rows or announce the same message
			// twice. `provider_id` is unique where present, so the retry is ignored and
			// the caller learns nothing was recorded.
			const result = await db
				.prepare(
					`INSERT OR IGNORE INTO unrouted_emails (id, provider_id, from_addr, to_addr, subject, reason)
					 VALUES (?, ?, ?, ?, ?, ?)`
				)
				.bind(crypto.randomUUID(), input.providerId, input.from, input.to, input.subject, input.reason)
				.run();
			return (result.meta?.changes ?? 0) > 0;
		},

		async listUnroutedEmails(limit) {
			const { results } = await db
				.prepare(
					`SELECT id, provider_id, from_addr, to_addr, subject, reason, created_at
					 FROM unrouted_emails ORDER BY datetime(created_at) DESC LIMIT ?`
				)
				.bind(limit)
				.all<UnroutedEmail>();
			return results;
		}
	};
}
