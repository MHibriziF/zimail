/**
 * Who hosts a call is read from the participant's *identity*, not an attribute.
 * Every token grants `canUpdateOwnMetadata` (renaming, the deafened badge), and
 * that also lets a guest set any attribute on themselves — including a
 * `role: 'host'` claim. The identity is the signed JWT's subject and can't be
 * changed from the client, so it's the only trustworthy place to mark the host.
 */
const HOST_IDENTITY_PREFIX = 'host-';

export function createHostIdentity(): string {
	return `${HOST_IDENTITY_PREFIX}${crypto.randomUUID()}`;
}

export function isHostIdentity(identity: string): boolean {
	return identity.startsWith(HOST_IDENTITY_PREFIX);
}
