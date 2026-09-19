import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createHostIdentity, isHostIdentity } from '../host-identity';

describe('host identity', () => {
	test('a minted host identity is recognized as the host', () => {
		assert.equal(isHostIdentity(createHostIdentity()), true);
	});

	test('each host identity is unique', () => {
		assert.notEqual(createHostIdentity(), createHostIdentity());
	});

	test('a plain guest identity is not the host', () => {
		assert.equal(isHostIdentity(crypto.randomUUID()), false);
	});
});
