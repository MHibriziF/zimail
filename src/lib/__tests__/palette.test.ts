import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	contrastRatio,
	PALETTE_PRESETS,
	PALETTE_SLOTS,
	paletteCss,
	parsePalettes,
	THEME_DEFAULTS
} from '../ui-theme/palette';
import { DEFAULT_APPEARANCE, exportTheme, importTheme } from '../ui-theme/appearance';

describe('parsePalettes', () => {
	test('keeps known slots with hex values and drops the rest', () => {
		assert.deepEqual(
			parsePalettes({ light: { surface: '#FFFFFF', text: 'black', glow: '#ff0000' }, dark: 'nope' }),
			{ light: { surface: '#ffffff' }, dark: {} }
		);
	});
});

describe('paletteCss', () => {
	test('writes nothing for an empty palette', () => {
		assert.equal(paletteCss({ light: {}, dark: {} }), '');
	});

	test('scopes each mode and drives both shells', () => {
		const css = paletteCss({ light: { surface: '#fbf8f2' }, dark: { text: '#efe7dc' } });
		assert.match(css, /:root\[data-ui-theme\]\[data-theme='light'\]\{[^}]*--color-surface: #fbf8f2;[^}]*--z-panel: #fbf8f2/);
		assert.match(css, /:root\[data-ui-theme\]\[data-theme='dark'\]\{[^}]*--color-text: #efe7dc;[^}]*--z-fg: #efe7dc/);
		assert.match(css, /--z-hover: color-mix/);
	});

	test('cannot be broken out of: only checked hex reaches the CSS', () => {
		const css = paletteCss(parsePalettes({ light: { text: '#fff}</style><script>' } }));
		assert.equal(css, '');
	});
});

describe('presets', () => {
	for (const preset of PALETTE_PRESETS) {
		test(`${preset.id} fills every slot and keeps text readable`, () => {
			for (const mode of ['light', 'dark'] as const) {
				const palette = preset.palettes[mode];
				assert.deepEqual(Object.keys(palette).sort(), [...PALETTE_SLOTS].sort());
				for (const ground of [palette.surface, palette.background, palette.raised] as string[]) {
					assert.ok(contrastRatio(palette.text as string, ground) >= 7, `${mode} text on ${ground}`);
					assert.ok(contrastRatio(palette.muted as string, ground) >= 4.5, `${mode} muted on ${ground}`);
				}
			}
		});
	}

	test('theme defaults are complete', () => {
		for (const theme of Object.values(THEME_DEFAULTS)) {
			for (const mode of ['light', 'dark'] as const) {
				assert.deepEqual(Object.keys(theme[mode]).sort(), [...PALETTE_SLOTS].sort());
			}
		}
	});
});

describe('contrastRatio', () => {
	test('black on white is 21:1', () => {
		assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
	});
});

describe('theme sharing', () => {
	test('round-trips through export and import', () => {
		const theme = { ...DEFAULT_APPEARANCE, accent: '#6f9fd8', palettes: PALETTE_PRESETS[1].palettes };
		assert.deepEqual(importTheme(exportTheme(theme)), theme);
	});

	test('rejects text that is not a shared theme', () => {
		assert.equal(importTheme('{"accent":"#ffffff"}'), null);
		assert.equal(importTheme('not json'), null);
	});
});
