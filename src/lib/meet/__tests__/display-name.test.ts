import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_DISPLAY_NAME_LENGTH, normalizeDisplayName } from '../display-name';

describe('normalizeDisplayName', () => {
	test('trims surrounding whitespace', () => {
		assert.equal(normalizeDisplayName('  Ada Lovelace  '), 'Ada Lovelace');
	});

	test('collapses runs of inner whitespace', () => {
		assert.equal(normalizeDisplayName('Ada \t  Lovelace'), 'Ada Lovelace');
	});

	test('rejects an empty or whitespace-only name', () => {
		assert.equal(normalizeDisplayName(''), null);
		assert.equal(normalizeDisplayName('   '), null);
	});

	test('caps the length', () => {
		const name = normalizeDisplayName('a'.repeat(MAX_DISPLAY_NAME_LENGTH + 20));
		assert.equal(name?.length, MAX_DISPLAY_NAME_LENGTH);
	});

	test('does not leave a trailing space where the cap cut a word boundary', () => {
		const name = normalizeDisplayName(`${'a'.repeat(MAX_DISPLAY_NAME_LENGTH - 1)} b`);
		assert.equal(name, 'a'.repeat(MAX_DISPLAY_NAME_LENGTH - 1));
	});
});
