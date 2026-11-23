import { EMPTY_PALETTES, isEmptyPalettes, paletteCss, parsePalettes, type Palettes } from './palette';

/**
 * How a user has tuned the look of either shell: an accent colour, their own palette, row
 * density, text size and font. Stored as JSON on the user and rendered on <html> and in a <style>
 * in <head>, so the first paint is already right. The accent's hover, tint and text colours are
 * derived from it in CSS.
 */
export const DENSITIES = ['comfortable', 'compact'] as const;
export const TEXT_SIZES = ['small', 'default', 'large'] as const;
export const FONTS = ['default', 'system', 'serif'] as const;

export type Density = (typeof DENSITIES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type FontChoice = (typeof FONTS)[number];

export type Appearance = {
	/** `#rrggbb`, or null for the theme's own accent. */
	accent: string | null;
	density: Density;
	textSize: TextSize;
	font: FontChoice;
	/** Base colours per mode; an empty palette keeps the theme's own. */
	palettes: Palettes;
};

export const DEFAULT_APPEARANCE: Appearance = {
	accent: null,
	density: 'comfortable',
	textSize: 'default',
	font: 'default',
	palettes: EMPTY_PALETTES
};

/** Picked to sit well on both light and dark surfaces; the first is the default sage. */
export const ACCENT_PRESETS = ['#90ac9a', '#7a9cc6', '#a38ec9', '#c98ea4', '#d39a6a', '#c2b26b'] as const;

const HEX = /^#[0-9a-f]{6}$/;

export function parseAccent(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const lower = value.trim().toLowerCase();
	return HEX.test(lower) ? lower : null;
}

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
	return options.includes(value as T) ? (value as T) : fallback;
}

/** Reads stored or posted appearance; anything missing or unknown falls back to the default. */
export function parseAppearance(value: unknown): Appearance {
	let raw: unknown = value;
	if (typeof value === 'string') {
		try {
			raw = JSON.parse(value);
		} catch {
			return { ...DEFAULT_APPEARANCE };
		}
	}
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_APPEARANCE };
	const input = raw as Record<string, unknown>;
	return {
		accent: parseAccent(input.accent),
		density: pick(DENSITIES, input.density, DEFAULT_APPEARANCE.density),
		textSize: pick(TEXT_SIZES, input.textSize, DEFAULT_APPEARANCE.textSize),
		font: pick(FONTS, input.font, DEFAULT_APPEARANCE.font),
		palettes: parsePalettes(input.palettes)
	};
}

export function isDefaultAppearance(appearance: Appearance): boolean {
	return (
		appearance.accent === DEFAULT_APPEARANCE.accent &&
		appearance.density === DEFAULT_APPEARANCE.density &&
		appearance.textSize === DEFAULT_APPEARANCE.textSize &&
		appearance.font === DEFAULT_APPEARANCE.font &&
		isEmptyPalettes(appearance.palettes)
	);
}

/** The stored form: null when nothing differs from the default, so most rows stay empty. */
export function serializeAppearance(appearance: Appearance): string | null {
	return isDefaultAppearance(appearance) ? null : JSON.stringify(appearance);
}

/**
 * The attributes the server adds to <html>. Only non-default values are written; every value
 * has already been checked against a fixed list or the hex pattern, so none needs escaping.
 */
export function appearanceAttributes(appearance: Appearance): string {
	const parts: string[] = [];
	if (appearance.density !== DEFAULT_APPEARANCE.density) parts.push(`data-density="${appearance.density}"`);
	if (appearance.textSize !== DEFAULT_APPEARANCE.textSize) parts.push(`data-text-size="${appearance.textSize}"`);
	if (appearance.font !== DEFAULT_APPEARANCE.font) parts.push(`data-font="${appearance.font}"`);
	if (appearance.accent) parts.push(`style="--color-accent: ${appearance.accent}"`);
	return parts.join(' ');
}

/** The same, on a live document: used to preview a change before it is saved. */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
	const set = (name: string, value: string, fallback: string) => {
		if (value === fallback) delete root.dataset[name];
		else root.dataset[name] = value;
	};
	set('density', appearance.density, DEFAULT_APPEARANCE.density);
	set('textSize', appearance.textSize, DEFAULT_APPEARANCE.textSize);
	set('font', appearance.font, DEFAULT_APPEARANCE.font);
	if (appearance.accent) root.style.setProperty('--color-accent', appearance.accent);
	else root.style.removeProperty('--color-accent');
	applyAppearanceCss(root.ownerDocument, appearance);
}

/** The palette's CSS, for the <style> the server puts in <head> and the editor's live preview. */
export function appearanceCss(appearance: Appearance): string {
	return paletteCss(appearance.palettes);
}

export const APPEARANCE_STYLE_ID = 'zimail-appearance';

/** Puts the palette on a live page, replacing what the server rendered. */
export function applyAppearanceCss(doc: Document, appearance: Appearance): void {
	let style = doc.getElementById(APPEARANCE_STYLE_ID);
	if (!style) {
		style = doc.createElement('style');
		style.id = APPEARANCE_STYLE_ID;
		doc.head.append(style);
	}
	style.textContent = appearanceCss(appearance);
}

const SHARE_FORMAT = 'zimail-theme@1';

/** A theme to share or back up: the colours and the look, not anything about the account. */
export function exportTheme(appearance: Appearance): string {
	const { accent, density, textSize, font, palettes } = appearance;
	return JSON.stringify({ format: SHARE_FORMAT, accent, density, textSize, font, palettes }, null, 2);
}

/** Reads a shared theme; null when the text is not one. Unknown values fall back like stored ones. */
export function importTheme(text: string): Appearance | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== SHARE_FORMAT) return null;
	return parseAppearance(raw);
}
