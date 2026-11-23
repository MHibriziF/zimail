import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addExample, GUIDE_ATTRIBUTES, GUIDE_EXAMPLES } from '../ui-theme/css-guide';
import { CHOICES } from '../ui-theme/appearance';

describe('addExample', () => {
	test('appends to what is there', () => {
		assert.equal(addExample('a { color: red; }', 'b { color: blue; }'), 'a { color: red; }\n\nb { color: blue; }');
		assert.equal(addExample('', 'b {}'), 'b {}');
	});

	test('puts an @import before every rule, as CSS requires', () => {
		const font = GUIDE_EXAMPLES.find((example) => example.id === 'font')?.css ?? '';
		const result = addExample('a { color: red; }', font);
		assert.ok(result.startsWith('@import'));
		assert.ok(result.indexOf('a { color: red; }') < result.indexOf(':root[data-ui-theme]'));
	});
});

describe('guide attributes', () => {
	test('list every Personalise choice, without its default', () => {
		assert.equal(GUIDE_ATTRIBUTES.length, Object.keys(CHOICES).length + 2);
		assert.deepEqual(GUIDE_ATTRIBUTES.find((a) => a.name === 'data-text-size')?.values, ['small', 'large']);
	});
});
