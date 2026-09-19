import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import {
	getDomainsService,
	getAddressForUser,
	getDomainByName,
	listAddressesForUser,
	recordUnroutedEmail,
	resolveInboundRoute
} from '../index';

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

function fakeDb(domains: DomainRow[] = [], addresses: AddressRow[] = []): D1Database {
	const unrouted: Array<{ id: string; provider_id: string | null; from_addr: string; to_addr: string; subject: string | null; reason: string; created_at: string }> = [];

	return createFakeD1(({ sql, args }) => {
		if (sql.startsWith('SELECT') && sql.includes('FROM domains') && sql.includes('WHERE id = ?')) {
			return domains.filter((row) => row.id === args[0]);
		}
		if (sql.includes('FROM domains') && sql.includes('WHERE name = ?')) {
			return domains.filter((row) => row.name === args[0]);
		}
		if (sql.startsWith('SELECT * FROM domains')) {
			return domains;
		}
		if (sql.includes('FROM addresses a JOIN domains d')) {
			if (sql.includes('WHERE a.id = ? AND a.user_id = ?')) {
				return addresses.filter((row) => row.id === args[0] && row.user_id === args[1]);
			}
			if (sql.includes('WHERE a.user_id = ?')) {
				return addresses.filter((row) => row.user_id === args[0]);
			}
			return addresses;
		}
		if (sql.includes('FROM addresses WHERE address IN')) {
			return [];
		}
		if (sql.includes('INTO unrouted_emails')) {
			const [id, providerId, from, to, subject, reason] = args as [
				string,
				string | null,
				string,
				string,
				string | null,
				string
			];
			unrouted.push({ id, provider_id: providerId, from_addr: from, to_addr: to, subject, reason, created_at: '2026-01-01' });
			return [];
		}
		throw new Error(`Unhandled query in fake D1: ${sql}`);
	});
}

describe('getDomainsService', () => {
	test('throws when the database is unavailable', () => {
		assert.throws(() => getDomainsService(undefined), /Database unavailable/);
	});

	test('builds a working service from a platform-shaped object', async () => {
		const domain = {
			id: 'domain-1',
			name: 'example.com',
			status: 'active',
			region: null,
			sending_enabled: 1,
			receiving_enabled: 1,
			catchall_user_id: null,
			created_at: '2026-01-01',
			synced_at: null
		};
		const platform = { env: { DB: fakeDb([domain]) } } as unknown as App.Platform;
		const service = getDomainsService(platform);
		const connected = await service.listConnected();
		assert.equal(connected[0]?.name, 'example.com');
	});
});

describe('legacy db-first facade', () => {
	test('getDomainByName delegates to the repository', async () => {
		const db = fakeDb([
			{
				id: 'domain-1',
				name: 'example.com',
				status: 'active',
				region: null,
				sending_enabled: 1,
				receiving_enabled: 1,
				catchall_user_id: 'user-1',
				created_at: '2026-01-01',
				synced_at: null
			}
		]);
		assert.equal((await getDomainByName(db, 'example.com'))?.id, 'domain-1');
	});

	test('resolveInboundRoute falls back to the catch-all owner', async () => {
		const db = fakeDb([
			{
				id: 'domain-1',
				name: 'example.com',
				status: 'active',
				region: null,
				sending_enabled: 1,
				receiving_enabled: 1,
				catchall_user_id: 'catchall-user',
				created_at: '2026-01-01',
				synced_at: null
			}
		]);
		const route = await resolveInboundRoute(db, ['nobody@example.com']);
		assert.equal(route?.userId, 'catchall-user');
	});

	test('listAddressesForUser and getAddressForUser delegate to the repository', async () => {
		const row: AddressRow = {
			id: 'address-1',
			user_id: 'user-1',
			domain_id: 'domain-1',
			domain_name: 'example.com',
			address: 'me@example.com',
			label: null,
			is_default: 1,
			signature: null,
			created_at: '2026-01-01'
		};
		const db = fakeDb([], [row]);
		assert.equal((await listAddressesForUser(db, 'user-1'))[0]?.address, 'me@example.com');
		assert.equal((await getAddressForUser(db, 'user-1', 'address-1'))?.address, 'me@example.com');
		assert.equal(await getAddressForUser(db, 'someone-else', 'address-1'), null);
	});

	test('recordUnroutedEmail writes through to the repository', async () => {
		const db = fakeDb();
		await assert.doesNotReject(
			recordUnroutedEmail(db, {
				providerId: null,
				from: 'a@b.com',
				to: 'nobody@example.com',
				subject: null,
				reason: 'no catch-all'
			})
		);
	});
});
