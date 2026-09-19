import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Domain, MailAddress } from '$lib/types';
import type { EmailProvider, ProviderDomain } from '../../email-provider';
import type { DomainsRepository, MatchedAddress } from '../repository';
import { createDomainsService, DomainsServiceError } from '../service';

function domain(overrides: Partial<Domain> = {}): Domain {
	return {
		id: 'domain-1',
		name: 'example.com',
		status: 'active',
		region: null,
		sending_enabled: true,
		receiving_enabled: true,
		catchall_user_id: null,
		created_at: '2026-01-01',
		synced_at: null,
		...overrides
	};
}

function address(overrides: Partial<MailAddress> = {}): MailAddress {
	return {
		id: 'address-1',
		user_id: 'user-1',
		domain_id: 'domain-1',
		domain_name: 'example.com',
		address: 'me@example.com',
		label: null,
		is_default: true,
		signature: null,
		created_at: '2026-01-01',
		...overrides
	};
}

/**
 * An in-memory `DomainsRepository` — no SQL, no D1, just plain arrays. This is
 * the payoff of the repository/service split: business rules get tested
 * without hand-rolling a fake database.
 */
function fakeRepo(seed: { domains?: Domain[]; addresses?: MailAddress[] } = {}): DomainsRepository {
	const domains = seed.domains ?? [];
	const addresses = seed.addresses ?? [];

	return {
		async listConnected() {
			return domains;
		},
		async getDomain(id) {
			return domains.find((d) => d.id === id) ?? null;
		},
		async getDomainByName(name) {
			return domains.find((d) => d.name === name) ?? null;
		},
		async upsertDomain(providerDomain: ProviderDomain) {
			const existing = domains.find((d) => d.id === providerDomain.id);
			const updated = domain({
				id: providerDomain.id,
				name: providerDomain.name,
				status: providerDomain.status,
				region: providerDomain.region ?? null,
				sending_enabled: providerDomain.sendingEnabled,
				receiving_enabled: providerDomain.receivingEnabled,
				catchall_user_id: existing?.catchall_user_id ?? null
			});
			if (existing) Object.assign(existing, updated);
			else domains.push(updated);
			return updated;
		},
		async disconnectDomain(id) {
			const index = domains.findIndex((d) => d.id === id);
			if (index >= 0) domains.splice(index, 1);
		},
		async setCatchallUser(domainId, userId) {
			const found = domains.find((d) => d.id === domainId);
			if (found) found.catchall_user_id = userId;
		},
		async markDomainMissing(id) {
			const found = domains.find((d) => d.id === id);
			if (found) Object.assign(found, { status: 'missing', sending_enabled: false, receiving_enabled: false });
		},
		async listAddressesForUser(userId) {
			return addresses.filter((a) => a.user_id === userId);
		},
		async listAllAddresses() {
			return addresses;
		},
		async getAddressForUser(userId, addressId) {
			return addresses.find((a) => a.id === addressId && a.user_id === userId) ?? null;
		},
		async findAddressByValue(value) {
			const found = addresses.find((a) => a.address === value);
			return found ? { id: found.id } : null;
		},
		async findAddressesByValues(values): Promise<MatchedAddress[]> {
			return addresses
				.filter((a) => values.includes(a.address))
				.map((a) => ({ id: a.id, userId: a.user_id, domainId: a.domain_id, address: a.address }));
		},
		async findDomainCatchallByName(name) {
			const found = domains.find((d) => d.name === name);
			return found ? { id: found.id, catchallUserId: found.catchall_user_id } : null;
		},
		async insertAddress(input) {
			addresses.push(
				address({
					id: input.id,
					user_id: input.userId,
					domain_id: input.domainId,
					address: input.address,
					label: input.label,
					is_default: input.isDefault
				})
			);
		},
		async updateAddressRow(userId, addressId, patch) {
			const found = addresses.find((a) => a.id === addressId && a.user_id === userId);
			if (found) Object.assign(found, patch);
		},
		async setDefaultAddress(userId, addressId) {
			for (const a of addresses) if (a.user_id === userId) a.is_default = a.id === addressId;
		},
		async deleteAddress(userId, addressId) {
			const index = addresses.findIndex((a) => a.id === addressId && a.user_id === userId);
			if (index >= 0) addresses.splice(index, 1);
		},
		async recordUnroutedEmail() {
			return true;
		},
		async listUnroutedEmails() {
			return [];
		}
	};
}

function fakeProvider(domains: ProviderDomain[] = []): EmailProvider {
	return {
		kind: 'resend',
		async send() {
			throw new Error('unused');
		},
		async listDomains() {
			return domains;
		},
		async getDomain(id) {
			const found = domains.find((d) => d.id === id);
			if (!found) throw new Error(`no such provider domain: ${id}`);
			return found;
		}
	};
}

describe('createAddress', () => {
	test('rejects an address on a domain that is not connected', async () => {
		const service = createDomainsService({ repo: fakeRepo() });
		await assert.rejects(
			service.createAddress({ userId: 'user-1', domainId: 'missing', localPart: 'me' }),
			(error) => error instanceof DomainsServiceError && error.message === 'Domain is not connected'
		);
	});

	test('rejects a local part with disallowed characters', async () => {
		const service = createDomainsService({ repo: fakeRepo({ domains: [domain()] }) });
		await assert.rejects(
			service.createAddress({ userId: 'user-1', domainId: 'domain-1', localPart: 'me you' }),
			/letters, numbers/
		);
	});

	test('rejects an address that already exists', async () => {
		const repo = fakeRepo({ domains: [domain()], addresses: [address({ address: 'me@example.com' })] });
		const service = createDomainsService({ repo });
		await assert.rejects(
			service.createAddress({ userId: 'user-2', domainId: 'domain-1', localPart: 'me' }),
			/already taken/
		);
	});

	test('the first address created for a user becomes their default', async () => {
		const repo = fakeRepo({ domains: [domain()] });
		const service = createDomainsService({ repo });
		const created = await service.createAddress({ userId: 'user-1', domainId: 'domain-1', localPart: 'Me' });
		assert.equal(created.address, 'me@example.com');
		assert.equal(created.is_default, true);
	});
});

describe('getAddressForUser / getDefaultAddress', () => {
	test('getAddressForUser only returns the owning user\'s address', async () => {
		const service = createDomainsService({ repo: fakeRepo({ addresses: [address({ user_id: 'someone-else' })] }) });
		assert.equal(await service.getAddressForUser('user-1', 'address-1'), null);
		assert.equal((await service.getAddressForUser('someone-else', 'address-1'))?.id, 'address-1');
	});

	test('getDefaultAddress returns the first of the user\'s addresses, or null', async () => {
		const service = createDomainsService({ repo: fakeRepo({ addresses: [address()] }) });
		assert.equal((await service.getDefaultAddress('user-1'))?.id, 'address-1');
		assert.equal(await service.getDefaultAddress('nobody'), null);
	});
});

describe('updateAddress', () => {
	test('rejects an address the user does not own', async () => {
		const repo = fakeRepo({ addresses: [address({ user_id: 'someone-else' })] });
		const service = createDomainsService({ repo });
		await assert.rejects(
			service.updateAddress('user-1', 'address-1', { label: 'Work' }),
			/Address not found/
		);
	});
});

describe('resolveInboundRoute', () => {
	test('prefers an exact address match, honouring recipient order', async () => {
		const repo = fakeRepo({
			addresses: [address({ id: 'a', address: 'first@example.com' }), address({ id: 'b', address: 'second@example.com' })]
		});
		const service = createDomainsService({ repo });
		const route = await service.resolveInboundRoute(['second@example.com', 'first@example.com']);
		assert.equal(route?.addressId, 'b');
		assert.equal(route?.viaCatchall, false);
	});

	test('falls back to the domain catch-all when no address matches', async () => {
		const repo = fakeRepo({ domains: [domain({ catchall_user_id: 'catchall-user' })] });
		const service = createDomainsService({ repo });
		const route = await service.resolveInboundRoute(['nobody@example.com']);
		assert.deepEqual(route, {
			userId: 'catchall-user',
			domainId: 'domain-1',
			addressId: null,
			address: 'nobody@example.com',
			viaCatchall: true
		});
	});

	test('returns null when nothing matches and there is no catch-all', async () => {
		const service = createDomainsService({ repo: fakeRepo({ domains: [domain({ catchall_user_id: null })] }) });
		assert.equal(await service.resolveInboundRoute(['nobody@example.com']), null);
	});
});

describe('sync', () => {
	test('refreshes domains still on the provider and marks the rest missing', async () => {
		const repo = fakeRepo({ domains: [domain({ id: 'kept' }), domain({ id: 'gone', name: 'gone.com' })] });
		const provider = fakeProvider([
			{ id: 'kept', name: 'example.com', status: 'active', sendingEnabled: true, receivingEnabled: true }
		]);
		const service = createDomainsService({ repo, getProvider: () => provider });

		const result = await service.sync();
		assert.equal(result.find((d) => d.id === 'kept')?.status, 'active');
		assert.equal(result.find((d) => d.id === 'gone')?.status, 'missing');
	});

	test('is a no-op when nothing is connected yet', async () => {
		const service = createDomainsService({
			repo: fakeRepo(),
			getProvider: () => {
				throw new Error('should not be called');
			}
		});
		assert.deepEqual(await service.sync(), []);
	});
});

describe('connect', () => {
	test('fetches each id from the provider and stores it', async () => {
		const repo = fakeRepo();
		const provider = fakeProvider([
			{ id: 'domain-1', name: 'example.com', status: 'active', sendingEnabled: true, receivingEnabled: true }
		]);
		const service = createDomainsService({ repo, getProvider: () => provider });
		const [connected] = await service.connect(['domain-1']);
		assert.equal(connected.name, 'example.com');
	});
});
