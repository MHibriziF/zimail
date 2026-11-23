/**
 * A user's own colours for the app's base surfaces, kept per light and dark mode. Each slot maps
 * onto the tokens both shells read (`--color-*` for Classic, `--z-*` as well for Zero), so one
 * palette re-colours either. Status colours (danger, star, success) are left to the theme.
 */
export const PALETTE_SLOTS = ['background', 'surface', 'raised', 'text', 'muted', 'border'] as const;
export type PaletteSlot = (typeof PALETTE_SLOTS)[number];
export type Palette = Partial<Record<PaletteSlot, string>>;
export type Mode = 'light' | 'dark';
export type Palettes = Record<Mode, Palette>;

export const EMPTY_PALETTES: Palettes = { light: {}, dark: {} };

/** What each theme shows when a slot is unset; used for the editor's swatches and contrast checks. */
export const THEME_DEFAULTS: Record<string, Record<Mode, Required<Palette>>> = {
	zero: {
		light: { background: '#fafafa', surface: '#ffffff', raised: '#f5f5f5', text: '#09090b', muted: '#71717a', border: '#e7e7e7' },
		dark: { background: '#141414', surface: '#1a1a1a', raised: '#202020', text: '#fafafa', muted: '#898989', border: '#252525' }
	},
	classic: {
		light: { background: '#fafafa', surface: '#ffffff', raised: '#f5f5f5', text: '#0a0a0a', muted: '#525252', border: '#ededed' },
		dark: { background: '#0e0e10', surface: '#17171a', raised: '#1f1f23', text: '#f4f4f5', muted: '#a8a8b3', border: '#2a2a2e' }
	}
};

const HEX = /^#[0-9a-f]{6}$/;

export function parseHex(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const lower = value.trim().toLowerCase();
	return HEX.test(lower) ? lower : null;
}

function parsePalette(value: unknown): Palette {
	if (!value || typeof value !== 'object') return {};
	const input = value as Record<string, unknown>;
	const palette: Palette = {};
	for (const slot of PALETTE_SLOTS) {
		const hex = parseHex(input[slot]);
		if (hex) palette[slot] = hex;
	}
	return palette;
}

export function parsePalettes(value: unknown): Palettes {
	const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return { light: parsePalette(input.light), dark: parsePalette(input.dark) };
}

export function isEmptyPalettes(palettes: Palettes): boolean {
	return Object.keys(palettes.light).length === 0 && Object.keys(palettes.dark).length === 0;
}

/** Every token a slot drives, in both shells. Values are checked hex, so they can be written as-is. */
function slotDeclarations(slot: PaletteSlot, hex: string): string[] {
	switch (slot) {
		case 'background':
			return [`--color-bg: ${hex}`, `--z-sidebar: ${hex}`];
		case 'surface':
			return [
				`--color-surface: ${hex}`,
				`--z-panel: ${hex}`,
				`--z-bg: ${hex}`,
				`--z-chip: ${hex}`,
				`--z-toolbar: ${hex}`,
				`--z-popover: ${hex}`,
				`--z-composer-field: ${hex}`
			];
		case 'raised':
			return [
				`--color-surface-muted: ${hex}`,
				`--z-well: ${hex}`,
				`--z-composer-bg: ${hex}`,
				`--z-overlay: ${hex}`,
				`--z-key: ${hex}`,
				`--offsetLight: ${hex}`
			];
		case 'text':
			return [`--color-text: ${hex}`, `--z-fg: ${hex}`, `--z-sidebar-fg: ${hex}`];
		case 'muted':
			return [
				`--color-text-secondary: ${hex}`,
				`--color-muted: ${hex}`,
				`--z-muted: ${hex}`,
				`--z-icon-muted: ${hex}`,
				`--icon-color: ${hex}`
			];
		case 'border':
			return [`--color-line: ${hex}`, `--z-border: ${hex}`, `--z-chip-border: ${hex}`];
		default: {
			const never: never = slot;
			return never;
		}
	}
}

/** Hover and pressed tints follow the text and surface, so a new palette never keeps the old grey. */
const DERIVED = [
	'--color-surface-hover: color-mix(in oklch, var(--color-text) 8%, var(--color-surface))',
	'--z-hover: color-mix(in oklch, var(--color-text) 5%, var(--color-surface))',
	'--z-chip-hover: color-mix(in oklch, var(--color-text) 9%, var(--color-surface))',
	'--z-key-hover: color-mix(in oklch, var(--color-text) 12%, var(--color-surface))',
	'--z-nav-active: color-mix(in oklch, var(--color-text) 7%, var(--color-bg))'
];

/**
 * The palette as CSS for a <style> in <head>. Scoped by `data-theme` (stamped before first paint),
 * and specific enough to beat each shell's own light and dark token blocks.
 */
export function paletteCss(palettes: Palettes): string {
	const blocks: string[] = [];
	for (const mode of ['light', 'dark'] as const) {
		const palette = palettes[mode];
		const slots = PALETTE_SLOTS.filter((slot) => palette[slot]);
		if (slots.length === 0) continue;
		const declarations = slots.flatMap((slot) => slotDeclarations(slot, palette[slot] as string));
		if (palette.surface || palette.text) declarations.push(...DERIVED);
		blocks.push(`:root[data-ui-theme][data-theme='${mode}']{${declarations.join(';')}}`);
	}
	return blocks.join('\n');
}

function channel(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	const n = Number.parseInt(hex.slice(1), 16);
	return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

export type PalettePreset = { id: string; accent: string; palettes: Palettes };

/** Ready-made looks. Each keeps text at 7:1 or more and muted text at 4.5:1 or more on its surfaces. */
export const PALETTE_PRESETS: PalettePreset[] = [
	{
		id: 'paper',
		accent: '#b5654a',
		palettes: {
			light: { background: '#f4efe6', surface: '#fbf8f2', raised: '#efe8dc', text: '#2b2520', muted: '#6b6258', border: '#e2d9cb' },
			dark: { background: '#1c1915', surface: '#24201b', raised: '#2c2721', text: '#efe7dc', muted: '#a89d90', border: '#38322a' }
		}
	},
	{
		id: 'frost',
		accent: '#6f9fd8',
		palettes: {
			light: { background: '#eef2f7', surface: '#f8fafc', raised: '#e8edf4', text: '#1f2937', muted: '#566375', border: '#d9e0ea' },
			dark: { background: '#20252e', surface: '#272d38', raised: '#2f3643', text: '#e6ebf2', muted: '#9aa6b6', border: '#363e4c' }
		}
	},
	{
		id: 'forest',
		accent: '#5f9d6b',
		palettes: {
			light: { background: '#eef3ee', surface: '#f8faf7', raised: '#e6eee6', text: '#1d2a20', muted: '#55665a', border: '#d6e1d7' },
			dark: { background: '#141a16', surface: '#1a221c', raised: '#212b23', text: '#e3ece4', muted: '#93a596', border: '#2b372d' }
		}
	},
	{
		id: 'rose',
		accent: '#c0718a',
		palettes: {
			light: { background: '#f8f0f2', surface: '#fdf9fa', raised: '#f3e8eb', text: '#2e2226', muted: '#6e5a61', border: '#ead9de' },
			dark: { background: '#1c1518', surface: '#241b1f', raised: '#2c2226', text: '#f1e4e8', muted: '#ab959c', border: '#3a2d32' }
		}
	},
	{
		id: 'midnight',
		accent: '#8b8cf0',
		palettes: {
			light: { background: '#f1f1f8', surface: '#fafafe', raised: '#eaeaf4', text: '#1c1c2e', muted: '#5b5b74', border: '#dcdcea' },
			dark: { background: '#0d0e1a', surface: '#141526', raised: '#1b1c30', text: '#e6e6f5', muted: '#9a9ab8', border: '#26273d' }
		}
	}
];
