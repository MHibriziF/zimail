import type { Domain, MailAddress } from '$lib/types';
import { parseMailboxSignature } from '$lib/email-signature';
import type { EmailProvider } from '../email-provider';
import type { DomainsRepository, NewUnroutedEmail, UnroutedEmail } from './repository';

export type InboundRoute = {
	userId: string;
	domainId: string | null;
	/** The registered address row that claimed the message; null via catch-all. */
	addressId: string | null;
	address: string;
	viaCatchall: boolean;
};

export type CreateAddressInput = {
	userId: string;
	domainId: string;
	localPart: string;
	label?: string | null;
};

export type AddressUpdate = { label?: string | null; signature?: string | null };

export class DomainsServiceError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'DomainsServiceError';
		this.status = status;
	}
}

const LOCAL_PART = /^[a-z0-9._%+-]+$/i;

export type DomainsService = {
	listConnected(): Promise<Domain[]>;
	getDomain(id: string): Promise<Domain | null>;
	sync(): Promise<Domain[]>;
	connect(providerDomainIds: string[]): Promise<Domain[]>;
	refreshDomain(id: string): Promise<Domain>;
	disconnectDomain(id: string): Promise<void>;
	setCatchallUser(domainId: string, userId: string | null): Promise<void>;

	listAddressesForUser(userId: string): Promise<MailAddress[]>;
	listAllAddresses(): Promise<MailAddress[]>;
	getAddressForUser(userId: string, addressId: string): Promise<MailAddress | null>;
	getDefaultAddress(userId: string): Promise<MailAddress | null>;
	createAddress(input: CreateAddressInput): Promise<MailAddress>;
	updateAddress(userId: string, addressId: string, patch: AddressUpdate): Promise<MailAddress>;
	setDefaultAddress(userId: string, addressId: string): Promise<void>;
	deleteAddress(userId: string, addressId: string): Promise<void>;

	resolveInboundRoute(recipients: string[]): Promise<InboundRoute | null>;
	/** Returns whether a new row was stored — false when this is a provider retry. */
	recordUnroutedEmail(input: NewUnroutedEmail): Promise<boolean>;
	listUnroutedEmails(limit?: number): Promise<UnroutedEmail[]>;
};

export type DomainsServiceDeps = {
	repo: DomainsRepository;
	/**
	 * Lazy so constructing the service never requires a configured mail
	 * provider — only `sync`/`connect`/`refreshDomain` actually call it.
	 */
	getProvider?: () => EmailProvider;
};

function requireProvider(deps: DomainsServiceDeps): EmailProvider {
	if (!deps.getProvider) {
		throw new DomainsServiceError(503, 'No email provider available in this context');
	}
	return deps.getProvider();
}

export function createDomainsService(deps: DomainsServiceDeps): DomainsService {
	const { repo } = deps;

	async function connectOne(providerDomainId: string): Promise<Domain> {
		const remote = await requireProvider(deps).getDomain(providerDomainId);
		return repo.upsertDomain(remote);
	}

	return {
		listConnected: () => repo.listConnected(),
		getDomain: (id) => repo.getDomain(id),

		async sync() {
			const connected = await repo.listConnected();
			if (connected.length === 0) return [];

			const remote = await requireProvider(deps).listDomains();
			const byId = new Map(remote.map((domain) => [domain.id, domain]));

			for (const domain of connected) {
				const match = byId.get(domain.id);
				if (match) {
					await repo.upsertDomain(match);
				} else {
					await repo.markDomainMissing(domain.id);
				}
			}

			return repo.listConnected();
		},

		async connect(providerDomainIds) {
			const connected: Domain[] = [];
			for (const id of providerDomainIds) {
				connected.push(await connectOne(id));
			}
			return connected;
		},

		refreshDomain: (id) => connectOne(id),
		disconnectDomain: (id) => repo.disconnectDomain(id),
		setCatchallUser: (domainId, userId) => repo.setCatchallUser(domainId, userId),

		listAddressesForUser: (userId) => repo.listAddressesForUser(userId),
		listAllAddresses: () => repo.listAllAddresses(),
		getAddressForUser: (userId, addressId) => repo.getAddressForUser(userId, addressId),

		async getDefaultAddress(userId) {
			const addresses = await repo.listAddressesForUser(userId);
			return addresses[0] ?? null;
		},

		async createAddress(input) {
			const domain = await repo.getDomain(input.domainId);
			if (!domain) {
				throw new DomainsServiceError(400, 'Domain is not connected');
			}

			const localPart = input.localPart.trim().toLowerCase().split('@')[0];
			if (!LOCAL_PART.test(localPart)) {
				throw new DomainsServiceError(400, 'Use letters, numbers and . _ % + - before the @');
			}

			const address = `${localPart}@${domain.name}`;
			const existing = await repo.findAddressByValue(address);
			if (existing) {
				throw new DomainsServiceError(400, `${address} is already taken`);
			}

			const isFirst = (await repo.listAddressesForUser(input.userId)).length === 0;
			const id = crypto.randomUUID();

			await repo.insertAddress({
				id,
				userId: input.userId,
				domainId: domain.id,
				address,
				label: input.label?.trim() || null,
				isDefault: isFirst
			});

			const created = await repo.getAddressForUser(input.userId, id);
			if (!created) throw new DomainsServiceError(400, 'Failed to create address');
			return created;
		},

		async updateAddress(userId, addressId, patch) {
			const current = await repo.getAddressForUser(userId, addressId);
			if (!current) {
				throw new DomainsServiceError(404, 'Address not found');
			}

			const label = patch.label !== undefined ? patch.label?.trim() || null : current.label;
			const signature =
				patch.signature !== undefined
					? parseMailboxSignature(patch.signature ?? '')
					: current.signature;

			await repo.updateAddressRow(userId, addressId, { label, signature });

			const saved = await repo.getAddressForUser(userId, addressId);
			if (!saved) throw new DomainsServiceError(400, 'Failed to update address');
			return saved;
		},

		setDefaultAddress: (userId, addressId) => repo.setDefaultAddress(userId, addressId),
		deleteAddress: (userId, addressId) => repo.deleteAddress(userId, addressId),

		/**
		 * The provider accepts mail for every address on a connected domain, so we
		 * try an exact address match first and fall back to the domain's catch-all
		 * owner.
		 */
		async resolveInboundRoute(recipients) {
			const candidates = recipients
				.map((value) => value.trim().toLowerCase())
				.filter((value) => value.includes('@'));

			if (candidates.length === 0) return null;

			const matches = await repo.findAddressesByValues(candidates);
			if (matches.length > 0) {
				// Honour the order the recipients arrived in, not the row order.
				for (const candidate of candidates) {
					const match = matches.find((row) => row.address.toLowerCase() === candidate);
					if (match) {
						return {
							userId: match.userId,
							domainId: match.domainId,
							addressId: match.id,
							address: match.address,
							viaCatchall: false
						};
					}
				}
			}

			for (const candidate of candidates) {
				const domainName = candidate.split('@')[1];
				if (!domainName) continue;

				const domain = await repo.findDomainCatchallByName(domainName);
				if (domain?.catchallUserId) {
					return {
						userId: domain.catchallUserId,
						domainId: domain.id,
						addressId: null,
						address: candidate,
						viaCatchall: true
					};
				}
			}

			return null;
		},

		recordUnroutedEmail: (input) => repo.recordUnroutedEmail(input),
		listUnroutedEmails: (limit = 50) => repo.listUnroutedEmails(limit)
	};
}
