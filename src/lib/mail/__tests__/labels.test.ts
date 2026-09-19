import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_LABEL_NAME_LENGTH, normalizeLabelName, parseLabelColor } from '../labels';

describe('normalizeLabelName', () => {
	test('trims and collapses whitespace', () => {
		assert.equal(normalizeLabelName('  Work   stuff '), 'Work stuff');
	});

	test('rejects an empty name', () => {
		assert.equal(normalizeLabelName('   '), null);
	});

	test('caps the length without leaving a trailing space', () => {
		const name = normalizeLabelName(`${'a'.repeat(MAX_LABEL_NAME_LENGTH - 1)} b`);
		assert.equal(name, 'a'.repeat(MAX_LABEL_NAME_LENGTH - 1));
	});
});

describe('parseLabelColor', () => {
	test('accepts a palette color', () => {
		assert.equal(parseLabelColor('teal'), 'teal');
	});

	test('rejects anything else, including raw CSS', () => {
		assert.equal(parseLabelColor('#ff0000'), undefined);
		assert.equal(parseLabelColor(undefined), undefined);
	});
});
