import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1DomainsRepository } from '../repository';

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
	address: string;
	label: string | null;
	is_default: number;
	signature: string | null;
	created_at: string;
};

type UnroutedRow = {
	id: string;
	provider_id: string | null;
	from_addr: string;
	to_addr: string;
	subject: string | null;
	reason: string;
	created_at: string;
};

function domainRow(overrides: Partial<DomainRow> = {}): DomainRow {
	return {
		id: 'domain-1',
		name: 'example.com',
		status: 'active',
		region: null,
		sending_enabled: 1,
		receiving_enabled: 1,
		catchall_user_id: null,
		created_at: '2026-01-01',
		synced_at: null,
		...overrides
	};
}

/** A fresh in-memory store + repository per test, so mutations never leak between tests. */
function setup(seed: { domains?: DomainRow[]; addresses?: AddressRow[]; unrouted?: UnroutedRow[] } = {}) {
	const domains = seed.domains ? seed.domains.map((row) => ({ ...row })) : [];
	const addresses = seed.addresses ? seed.addresses.map((row) => ({ ...row })) : [];
	const unrouted = seed.unrouted ? seed.unrouted.map((row) => ({ ...row })) : [];

	const db = createFakeD1(({ sql, args }) => {
		if (sql.startsWith('SELECT') && sql.includes('FROM domains') && sql.includes('WHERE id = ?')) {
			return domains.filter((row) => row.id === args[0]);
		}
		if (sql.includes('SELECT id, catchall_user_id FROM domains')) {
			return domains.filter((row) => row.name === args[0]);
		}
		if (sql.includes('FROM domains') && sql.includes('WHERE name = ?')) {
			return domains.filter((row) => row.name === args[0]);
		}
		if (sql.startsWith('SELECT * FROM domains')) {
			return [...domains].sort((a, b) => a.created_at.localeCompare(b.created_at));
		}
		if (sql.startsWith('INSERT INTO domains')) {
			const [id, name, status, region, sendingEnabled, receivingEnabled] = args as [
				string,
				string,
				string,
				string | null,
				number,
				number
			];
			const existing = domains.find((row) => row.id === id);
			if (existing) {
				Object.assign(existing, { name, status, region, sending_enabled: sendingEnabled, receiving_enabled: receivingEnabled, synced_at: 'now' });
			} else {
				domains.push(
					domainRow({ id, name, status, region, sending_enabled: sendingEnabled, receiving_enabled: receivingEnabled, synced_at: 'now' })
				);
			}
			return [];
		}
		if (sql.startsWith("UPDATE domains SET status = 'missing'")) {
			const row = domains.find((row) => row.id === args[0]);
			if (row) Object.assign(row, { status: 'missing', sending_enabled: 0, receiving_enabled: 0 });
			return [];
		}
		if (sql.startsWith('UPDATE domains SET catchall_user_id')) {
			const row = domains.find((row) => row.id === args[1]);
			if (row) row.catchall_user_id = args[0] as string | null;
			return [];
		}
		if (sql.startsWith('DELETE FROM domains')) {
			const index = domains.findIndex((row) => row.id === args[0]);
			if (index >= 0) domains.splice(index, 1);
			return [];
		}

		if (sql.includes('FROM addresses a JOIN domains d')) {
			let rows = addresses.map((row) => {
				const domain = domains.find((d) => d.id === row.domain_id);
				return { ...row, domain_name: domain?.name ?? '' };
			});
			if (sql.includes('WHERE a.id = ? AND a.user_id = ?')) {
				rows = rows.filter((row) => row.id === args[0] && row.user_id === args[1]);
			} else if (sql.includes('WHERE a.user_id = ?')) {
				rows = rows.filter((row) => row.user_id === args[0]);
			}
			return rows;
		}
		if (sql === 'SELECT id FROM addresses WHERE address = ?') {
			return addresses.filter((row) => row.address === args[0]).map((row) => ({ id: row.id }));
		}
		if (sql.includes('FROM addresses WHERE address IN')) {
			return addresses
				.filter((row) => args.includes(row.address))
				.map((row) => ({
					id: row.id,
					user_id: row.user_id,
					domain_id: row.domain_id,
					address: row.address
				}));
		}
		if (sql.startsWith('INSERT INTO addresses')) {
			const [id, userId, domainId, address, label, isDefault] = args as [
				string,
				string,
				string,
				string,
				string | null,
				number
			];
			addresses.push({ id, user_id: userId, domain_id: domainId, address, label, is_default: isDefault, signature: null, created_at: '2026-01-01' });
			return [];
		}
		if (sql.startsWith('UPDATE addresses SET label = ?, signature = ?')) {
			const [label, signature, id, userId] = args as [string | null, string | null, string, string];
			const row = addresses.find((row) => row.id === id && row.user_id === userId);
			if (row) Object.assign(row, { label, signature });
			return [];
		}
		if (sql === 'UPDATE addresses SET is_default = 0 WHERE user_id = ?') {
			for (const row of addresses) if (row.user_id === args[0]) row.is_default = 0;
			return [];
		}
		if (sql.includes('UPDATE addresses SET is_default = 1')) {
			const row = addresses.find((row) => row.id === args[0] && row.user_id === args[1]);
			if (row) row.is_default = 1;
			return [];
		}
		if (sql.startsWith('DELETE FROM addresses')) {
			const index = addresses.findIndex((row) => row.id === args[0] && row.user_id === args[1]);
			if (index >= 0) addresses.splice(index, 1);
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
			// Mirrors the partial unique index on provider_id plus INSERT OR IGNORE.
			if (providerId && unrouted.some((row) => row.provider_id === providerId)) return [];
			const row = { id, provider_id: providerId, from_addr: from, to_addr: to, subject, reason, created_at: '2026-01-01' };
			unrouted.push(row);
			return [row];
		}
		if (sql.includes('FROM unrouted_emails')) {
			return [...unrouted].slice(0, args[0] as number);
		}

		throw new Error(`Unhandled query in fake D1: ${sql}`);
	});

	return { repo: createD1DomainsRepository(db), domains, addresses, unrouted };
}

describe('DomainsRepository — domains', () => {
	test('listConnected returns every connected domain', async () => {
		const { repo } = setup({ domains: [domainRow({ id: 'a' }), domainRow({ id: 'b', name: 'other.com' })] });
		const result = await repo.listConnected();
		assert.deepEqual(
			result.map((d) => d.id),
			['a', 'b']
		);
	});

	test('upsertDomain inserts a new row and updates an existing one', async () => {
		const { repo, domains } = setup();
		await repo.upsertDomain({
			id: 'domain-1',
			name: 'Example.com',
			status: 'pending',
			region: null,
			sendingEnabled: false,
			receivingEnabled: false
		});
		assert.equal(domains.length, 1);
		assert.equal(domains[0].name, 'example.com');
		assert.equal(domains[0].sending_enabled, 0);

		const saved = await repo.upsertDomain({
			id: 'domain-1',
			name: 'example.com',
			status: 'active',
			region: 'us-east',
			sendingEnabled: true,
			receivingEnabled: true
		});
		assert.equal(domains.length, 1);
		assert.equal(saved.status, 'active');
		assert.equal(saved.sending_enabled, true);
	});

	test('markDomainMissing flags the domain without deleting it', async () => {
		const { repo, domains } = setup({ domains: [domainRow()] });
		await repo.markDomainMissing('domain-1');
		assert.equal(domains[0].status, 'missing');
		assert.equal(domains[0].sending_enabled, 0);
	});

	test('findDomainCatchallByName reports the catch-all owner, case-insensitively', async () => {
		const { repo } = setup({ domains: [domainRow({ catchall_user_id: 'user-1' })] });
		assert.deepEqual(await repo.findDomainCatchallByName('Example.COM'), {
			id: 'domain-1',
			catchallUserId: 'user-1'
		});
		assert.equal(await repo.findDomainCatchallByName('missing.com'), null);
	});

	test('getDomain and getDomainByName look up a single connected domain', async () => {
		const { repo } = setup({ domains: [domainRow()] });
		assert.equal((await repo.getDomain('domain-1'))?.name, 'example.com');
		assert.equal(await repo.getDomain('missing'), null);
		assert.equal((await repo.getDomainByName('example.com'))?.id, 'domain-1');
		assert.equal(await repo.getDomainByName('missing.com'), null);
	});

	test('disconnectDomain removes the row', async () => {
		const { repo, domains } = setup({ domains: [domainRow()] });
		await repo.disconnectDomain('domain-1');
		assert.equal(domains.length, 0);
	});

	test('setCatchallUser updates the owner', async () => {
		const { repo, domains } = setup({ domains: [domainRow()] });
		await repo.setCatchallUser('domain-1', 'user-1');
		assert.equal(domains[0].catchall_user_id, 'user-1');
	});
});

describe('DomainsRepository — addresses', () => {
	function addressRow(overrides: Partial<AddressRow> = {}): AddressRow {
		return {
			id: 'address-1',
			user_id: 'user-1',
			domain_id: 'domain-1',
			address: 'me@example.com',
			label: null,
			is_default: 1,
			signature: null,
			created_at: '2026-01-01',
			...overrides
		};
	}

	test('listAddressesForUser joins in the domain name', async () => {
		const { repo } = setup({ domains: [domainRow()], addresses: [addressRow()] });
		const [address] = await repo.listAddressesForUser('user-1');
		assert.equal(address.domain_name, 'example.com');
	});

	test('listAllAddresses returns every address regardless of owner', async () => {
		const { repo } = setup({
			domains: [domainRow()],
			addresses: [addressRow({ id: 'a', user_id: 'user-1' }), addressRow({ id: 'b', user_id: 'user-2' })]
		});
		const all = await repo.listAllAddresses();
		assert.deepEqual(
			all.map((a) => a.id),
			['a', 'b']
		);
	});

	test('findAddressByValue looks up an address by its value', async () => {
		const { repo } = setup({ addresses: [addressRow()] });
		assert.deepEqual(await repo.findAddressByValue('me@example.com'), { id: 'address-1' });
		assert.equal(await repo.findAddressByValue('nobody@example.com'), null);
	});

	test('findAddressesByValues matches on the address column', async () => {
		const { repo } = setup({ addresses: [addressRow(), addressRow({ id: 'address-2', address: 'other@example.com' })] });
		const matches = await repo.findAddressesByValues(['other@example.com', 'nobody@example.com']);
		assert.deepEqual(matches, [{ id: 'address-2', userId: 'user-1', domainId: 'domain-1', address: 'other@example.com' }]);
	});

	test('insertAddress then getAddressForUser round-trips the new row', async () => {
		const { repo } = setup({ domains: [domainRow()] });
		await repo.insertAddress({
			id: 'address-9',
			userId: 'user-1',
			domainId: 'domain-1',
			address: 'new@example.com',
			label: 'Work',
			isDefault: true
		});
		const saved = await repo.getAddressForUser('user-1', 'address-9');
		assert.equal(saved?.address, 'new@example.com');
		assert.equal(saved?.is_default, true);
	});

	test('updateAddressRow only updates the owning user\'s row', async () => {
		const { repo } = setup({ domains: [domainRow()], addresses: [addressRow()] });
		await repo.updateAddressRow('someone-else', 'address-1', { label: 'Nope', signature: null });
		assert.equal((await repo.getAddressForUser('user-1', 'address-1'))?.label, null);

		await repo.updateAddressRow('user-1', 'address-1', { label: 'Home', signature: 'Cheers' });
		const saved = await repo.getAddressForUser('user-1', 'address-1');
		assert.equal(saved?.label, 'Home');
		assert.equal(saved?.signature, 'Cheers');
	});

	test('setDefaultAddress clears every other default for that user', async () => {
		const { repo, addresses } = setup({
			addresses: [addressRow({ id: 'a', is_default: 1 }), addressRow({ id: 'b', is_default: 0 })]
		});
		await repo.setDefaultAddress('user-1', 'b');
		assert.deepEqual(
			addresses.map((row) => [row.id, row.is_default]),
			[
				['a', 0],
				['b', 1]
			]
		);
	});

	test('deleteAddress only removes the owning user\'s row', async () => {
		const { repo, addresses } = setup({ addresses: [addressRow({ user_id: 'someone-else' })] });
		await repo.deleteAddress('user-1', 'address-1');
		assert.equal(addresses.length, 1);
		await repo.deleteAddress('someone-else', 'address-1');
		assert.equal(addresses.length, 0);
	});
});

describe('DomainsRepository — unrouted mail', () => {
	test('recordUnroutedEmail then listUnroutedEmails round-trips and respects the limit', async () => {
		const { repo } = setup();
		await repo.recordUnroutedEmail({
			providerId: 'p1',
			from: 'a@b.com',
			to: 'nobody@example.com',
			subject: 'hi',
			reason: 'no catch-all'
		});
		await repo.recordUnroutedEmail({
			providerId: 'p2',
			from: 'c@d.com',
			to: 'also-nobody@example.com',
			subject: null,
			reason: 'no catch-all'
		});
		const results = await repo.listUnroutedEmails(1);
		assert.equal(results.length, 1);
		assert.equal(results[0].to_addr, 'nobody@example.com');
	});

	test('a provider retry of the same message is ignored and reported as not stored', async () => {
		const { repo, unrouted } = setup();
		const input = { providerId: 'p1', from: 'a@b.com', to: 'nobody@example.com', subject: 'hi', reason: 'no catch-all' };
		assert.equal(await repo.recordUnroutedEmail(input), true);
		assert.equal(await repo.recordUnroutedEmail(input), false);
		assert.equal(unrouted.length, 1);
	});

	test('mail without a provider id is never treated as a duplicate', async () => {
		const { repo, unrouted } = setup();
		const input = { providerId: null, from: 'a@b.com', to: 'nobody@example.com', subject: 'hi', reason: 'no catch-all' };
		assert.equal(await repo.recordUnroutedEmail(input), true);
		assert.equal(await repo.recordUnroutedEmail(input), true);
		assert.equal(unrouted.length, 2);
	});
});
