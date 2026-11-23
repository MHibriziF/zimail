import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	appearanceAttributes,
	clampPane,
	appearanceCss,
	embeddableCss,
	MAX_CUSTOM_CSS,
	DEFAULT_APPEARANCE,
	parseAccent,
	parseAppearance,
	serializeAppearance
} from '../ui-theme/appearance';

describe('parseAppearance', () => {
	test('reads stored JSON', () => {
		const stored = '{"accent":"#7A9CC6","density":"compact","textSize":"large","font":"serif"}';
		assert.deepEqual(parseAppearance(stored), {
			...DEFAULT_APPEARANCE,
			accent: '#7a9cc6',
			density: 'compact',
			textSize: 'large',
			font: 'serif',
			palettes: { light: {}, dark: {} }
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
			appearanceAttributes({ ...DEFAULT_APPEARANCE, accent: '#c98ea4', density: 'compact', font: 'system' }),
			'data-density="compact" data-font="system" style="--color-accent: #c98ea4"'
		);
	});

	test('names multi-word settings in kebab case, and covers the layout choices', () => {
		assert.equal(
			appearanceAttributes({ ...DEFAULT_APPEARANCE, textSize: 'large', radius: 'round', listWidth: 'wide', preview: 'none' }),
			'data-text-size="large" data-radius="round" data-list="wide" data-preview="none"'
		);
	});
});

describe('custom CSS', () => {
	test('cannot close its style element', () => {
		const css = embeddableCss('a::after { content: "</style><script>alert(1)</script>"; }');
		assert.ok(!css.includes('<'));
		assert.ok(css.includes('\\3c /style>'));
	});

	test('is capped, kept out of safe mode, and counts as a change', () => {
		const long = parseAppearance({ customCss: 'x'.repeat(MAX_CUSTOM_CSS + 50) });
		assert.equal(long.customCss.length, MAX_CUSTOM_CSS);

		const styled = { ...DEFAULT_APPEARANCE, customCss: '.z-row { letter-spacing: 0.01em; }' };
		assert.equal(appearanceCss(styled), '.z-row { letter-spacing: 0.01em; }');
		assert.equal(appearanceCss(styled, { custom: false }), '');
		assert.notEqual(serializeAppearance(styled), null);
		assert.equal(serializeAppearance({ ...DEFAULT_APPEARANCE, customCss: '   ' }), null);
	});
});

describe('dragged pane widths', () => {
	test('are clamped to a readable range and dropped when not numbers', () => {
		assert.equal(parseAppearance({ sidebarPx: 40 }).sidebarPx, 180);
		assert.equal(parseAppearance({ listPx: 5000 }).listPx, 900);
		assert.equal(parseAppearance({ listPx: 412.6 }).listPx, 413);
		assert.equal(parseAppearance({ sidebarPx: '300px' }).sidebarPx, null);
		assert.equal(clampPane('sidebarPx', 300), 300);
	});

	test('reach <html> as a flag and a variable, sharing the style with the accent', () => {
		assert.equal(
			appearanceAttributes({ ...DEFAULT_APPEARANCE, accent: '#7a9cc6', sidebarPx: 300, listPx: 420 }),
			'data-sized-sidebar data-sized-list style="--color-accent: #7a9cc6; --sidebar-px: 300px; --list-px: 420px"'
		);
		assert.notEqual(serializeAppearance({ ...DEFAULT_APPEARANCE, listPx: 420 }), null);
	});
});
