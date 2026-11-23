import { EMPTY_PALETTES, isEmptyPalettes, paletteCss, parsePalettes, type Palettes } from './palette';

/**
 * How a user has tuned the look of either shell: an accent colour, their own palette, and a set
 * of fixed choices (density, text size, font, corners, widths, preview lines). Stored as JSON on
 * the user and rendered on <html> and in a <style> in <head>, so the first paint is already right.
 * The accent's hover, tint and text colours are derived from it in CSS.
 */

/**
 * Every fixed choice: its options (the first is the default) and the `data-*` attribute on <html>
 * that the CSS reads. A new setting is a row here plus the CSS for its attribute.
 */
export const CHOICES = {
	density: { attribute: 'density', options: ['comfortable', 'compact'] },
	textSize: { attribute: 'textSize', options: ['default', 'small', 'large'] },
	font: { attribute: 'font', options: ['default', 'system', 'serif'] },
	radius: { attribute: 'radius', options: ['default', 'sharp', 'round'] },
	sidebar: { attribute: 'sidebar', options: ['default', 'narrow', 'wide'] },
	listWidth: { attribute: 'list', options: ['default', 'narrow', 'wide'] },
	preview: { attribute: 'preview', options: ['auto', 'none', 'one', 'two'] }
} as const;

type Choices = typeof CHOICES;
export type ChoiceKey = keyof Choices;
export type ChoiceValue<K extends ChoiceKey> = Choices[K]['options'][number];
export type Density = ChoiceValue<'density'>;
export type TextSize = ChoiceValue<'textSize'>;
export type FontChoice = ChoiceValue<'font'>;

const CHOICE_KEYS = Object.keys(CHOICES) as ChoiceKey[];

export type Appearance = { [K in ChoiceKey]: ChoiceValue<K> } & {
	/** `#rrggbb`, or null for the theme's own accent. */
	accent: string | null;
	/** Base colours per mode; an empty palette keeps the theme's own. */
	palettes: Palettes;
	/** The user's own CSS, applied after everything else. Empty for most people. */
	customCss: string;
};

/** Room for a real stylesheet, small enough that it never weighs down the page or the row. */
export const MAX_CUSTOM_CSS = 20_000;

function defaultChoices(): { [K in ChoiceKey]: ChoiceValue<K> } {
	return Object.fromEntries(CHOICE_KEYS.map((key) => [key, CHOICES[key].options[0]])) as {
		[K in ChoiceKey]: ChoiceValue<K>;
	};
}

export const DEFAULT_APPEARANCE: Appearance = {
	...defaultChoices(),
	accent: null,
	palettes: EMPTY_PALETTES,
	customCss: ''
};

/** Picked to sit well on both light and dark surfaces; the first is the default sage. */
export const ACCENT_PRESETS = ['#90ac9a', '#7a9cc6', '#a38ec9', '#c98ea4', '#d39a6a', '#c2b26b'] as const;

const HEX = /^#[0-9a-f]{6}$/;

export function parseAccent(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const lower = value.trim().toLowerCase();
	return HEX.test(lower) ? lower : null;
}

function pickChoice<K extends ChoiceKey>(key: K, value: unknown): ChoiceValue<K> {
	const options = CHOICES[key].options as readonly string[];
	return (options.includes(value as string) ? value : options[0]) as ChoiceValue<K>;
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
	const choices = Object.fromEntries(CHOICE_KEYS.map((key) => [key, pickChoice(key, input[key])]));
	return {
		...(choices as { [K in ChoiceKey]: ChoiceValue<K> }),
		accent: parseAccent(input.accent),
		palettes: parsePalettes(input.palettes),
		customCss: typeof input.customCss === 'string' ? input.customCss.slice(0, MAX_CUSTOM_CSS) : ''
	};
}

export function isDefaultAppearance(appearance: Appearance): boolean {
	return (
		appearance.accent === null &&
		isEmptyPalettes(appearance.palettes) &&
		appearance.customCss.trim() === '' &&
		CHOICE_KEYS.every((key) => appearance[key] === CHOICES[key].options[0])
	);
}

/** The stored form: null when nothing differs from the default, so most rows stay empty. */
export function serializeAppearance(appearance: Appearance): string | null {
	return isDefaultAppearance(appearance) ? null : JSON.stringify(appearance);
}

/** `textSize` -> `text-size`, for the attribute name in HTML. */
function kebab(name: string): string {
	return name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * The attributes the server adds to <html>. Only non-default values are written; every value
 * has already been checked against a fixed list or the hex pattern, so none needs escaping.
 */
export function appearanceAttributes(appearance: Appearance): string {
	const parts = CHOICE_KEYS.filter((key) => appearance[key] !== CHOICES[key].options[0]).map(
		(key) => `data-${kebab(CHOICES[key].attribute)}="${appearance[key]}"`
	);
	if (appearance.accent) parts.push(`style="--color-accent: ${appearance.accent}"`);
	return parts.join(' ');
}

/** The same, on a live document: used to preview a change before it is saved. */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
	for (const key of CHOICE_KEYS) {
		const name = CHOICES[key].attribute;
		if (appearance[key] === CHOICES[key].options[0]) delete root.dataset[name];
		else root.dataset[name] = appearance[key];
	}
	if (appearance.accent) root.style.setProperty('--color-accent', appearance.accent);
	else root.style.removeProperty('--color-accent');
	applyAppearanceCss(root.ownerDocument, appearance);
}

/** Palette, then the user's CSS: the <style> the server puts in <head> and the editor's live preview. */
export function appearanceCss(appearance: Appearance, { custom = true } = {}): string {
	const parts = [paletteCss(appearance.palettes)];
	if (custom) parts.push(embeddableCss(appearance.customCss));
	return parts.filter(Boolean).join('\n');
}

/**
 * The user's CSS, safe to put inside a <style> element. A literal `<` can only matter by closing
 * the element (`</style>`); CSS has no other use for it outside strings, and `\3c ` is the same
 * character inside one, so the stylesheet keeps its meaning and cannot end early.
 */
export function embeddableCss(css: string): string {
	return css.trim().replaceAll('<', '\\3c ');
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
	return JSON.stringify({ format: SHARE_FORMAT, ...appearance }, null, 2);
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
