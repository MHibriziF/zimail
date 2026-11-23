import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	appearanceAttributes,
	DEFAULT_APPEARANCE,
	parseAccent,
	parseAppearance,
	serializeAppearance
} from '../ui-theme/appearance';

describe('parseAppearance', () => {
	test('reads stored JSON', () => {
		const stored = '{"accent":"#7A9CC6","density":"compact","textSize":"large","font":"serif"}';
		assert.deepEqual(parseAppearance(stored), {
			accent: '#7a9cc6',
			density: 'compact',
			textSize: 'large',
			font: 'serif'
		});
	});

	test('falls back field by field', () => {
		assert.deepEqual(parseAppearance({ density: 'compact', font: 'comic-sans', accent: 'red' }), {
			...DEFAULT_APPEARANCE,
			density: 'compact'
		});
	});

	test('treats nothing, junk and broken JSON as the default', () => {
		for (const value of [null, undefined, '', '{', 42, []]) {
			assert.deepEqual(parseAppearance(value), DEFAULT_APPEARANCE);
		}
	});
});

describe('parseAccent', () => {
	test('accepts six-digit hex only', () => {
		assert.equal(parseAccent(' #A38EC9 '), '#a38ec9');
		assert.equal(parseAccent('#abc'), null);
		assert.equal(parseAccent('rgb(1,2,3)'), null);
		assert.equal(parseAccent('#a38ec9"; background: url(x)'), null);
	});
});

describe('serializeAppearance', () => {
	test('stores nothing for the default', () => {
		assert.equal(serializeAppearance(DEFAULT_APPEARANCE), null);
	});

	test('round-trips a change', () => {
		const changed = { ...DEFAULT_APPEARANCE, textSize: 'small' as const };
		assert.deepEqual(parseAppearance(serializeAppearance(changed)), changed);
	});
});

describe('appearanceAttributes', () => {
	test('writes only what differs from the default', () => {
		assert.equal(appearanceAttributes(DEFAULT_APPEARANCE), '');
		assert.equal(
			appearanceAttributes({ accent: '#c98ea4', density: 'compact', textSize: 'default', font: 'system' }),
			'data-density="compact" data-font="system" style="--color-accent: #c98ea4"'
		);
	});
});
