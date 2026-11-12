import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { colorFor, initialsFor } from '../avatar';

describe('initialsFor', () => {
	test('takes the first letter of the first two words, upper-cased', () => {
		assert.equal(initialsFor('Ada Lovelace'), 'AL');
		assert.equal(initialsFor('grace brewster murray hopper'), 'GB');
		assert.equal(initialsFor('  Ada  '), 'A');
	});

	test('falls back to a question mark for a blank name', () => {
		assert.equal(initialsFor(''), '?');
		assert.equal(initialsFor('   '), '?');
	});
});

describe('colorFor', () => {
	test('is stable for the same identity and an hsl colour', () => {
		assert.equal(colorFor('user-1'), colorFor('user-1'));
		assert.match(colorFor('user-1'), /^hsl\(\d{1,3}, 45%, 38%\)$/);
	});

	test('differs between identities', () => {
		assert.notEqual(colorFor('user-1'), colorFor('user-2'));
	});
});
