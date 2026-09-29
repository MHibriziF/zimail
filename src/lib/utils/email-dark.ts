/**
 * A styled email, recoloured for a dark page the way Outlook and Apple Mail do
 * it: light pages go dark and dark ink goes light, each colour keeping its hue,
 * while images are left alone. Used only for a sender who wrote no dark version
 * of their own; the reader can always switch back to the original.
 */

/**
 * A declaration ends at a semicolon or a brace — but in markup it also ends at
 * the quote closing the style attribute. Without that, `color:#111"><td
 * style="background:#fff` reads as one long colour declaration and the
 * background is judged as if it were text.
 */
const COLOUR_DECLARATION =
	/\b(background(?:-color)?|color|border(?:-[a-z-]+)?|outline(?:-[a-z-]+)?)\s*:[^;}"'<>]*/gi;
const COLOUR_LITERAL =
	/#[0-9a-f]{3,8}|rgba?\([^)]{1,160}\)|\b(?:black|white|darkgray|darkgrey|lightgray|lightgrey)\b/gi;
const HTML_TAG = /<[a-z][^>]{0,8192}>/gi;
const COLOUR_ATTRIBUTE =
	/(^|\s)(bgcolor|color)\s*=\s*(["']?)(#[0-9a-f]{3,8}|rgba?\([^)]{1,160}\)|(?:black|white|darkgray|darkgrey|lightgray|lightgrey))\3/gi;

const NAMED_COLOUR_VALUES: Record<string, [number, number, number, number]> = {
	black: [0, 0, 0, 1],
	white: [1, 1, 1, 1],
	darkgray: [169 / 255, 169 / 255, 169 / 255, 1],
	darkgrey: [169 / 255, 169 / 255, 169 / 255, 1],
	lightgray: [211 / 255, 211 / 255, 211 / 255, 1],
	lightgrey: [211 / 255, 211 / 255, 211 / 255, 1]
};

function rgba(literal: string): [number, number, number, number] | null {
	const value = literal.trim().toLowerCase();

	if (value.startsWith('#')) return hexRgba(value.slice(1));
	if (Object.hasOwn(NAMED_COLOUR_VALUES, value)) return NAMED_COLOUR_VALUES[value];
	return functionRgba(value);
}

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, without the `#`, as eight hex digits. */
function expandHex(hex: string): string | null {
	switch (hex.length) {
		case 3:
			return `${[...hex].map((digit) => digit + digit).join('')}ff`;
		case 4:
			return [...hex].map((digit) => digit + digit).join('');
		case 6:
			return `${hex}ff`;
		case 8:
			return hex;
		default:
			return null;
	}
}

function hexRgba(hex: string): [number, number, number, number] | null {
	const expanded = expandHex(hex);
	if (!expanded) return null;

	const packed = Number.parseInt(expanded, 16);
	if (Number.isNaN(packed)) return null;
	return [
		((packed >>> 24) & 0xff) / 255,
		((packed >>> 16) & 0xff) / 255,
		((packed >>> 8) & 0xff) / 255,
		(packed & 0xff) / 255
	];
}

/** `rgb(…)` / `rgba(…)`, with channels as numbers or percentages. */
function functionRgba(value: string): [number, number, number, number] | null {
	const parts = value
		.replace(/rgba?|\(|\)/g, '')
		.split(/[,/\s]+/)
		.filter(Boolean);
	if (parts.length < 3) return null;

	const channel = (part: string) => {
		const parsed = Number.parseFloat(part);
		if (Number.isNaN(parsed)) return null;
		const normalized = part.endsWith('%') ? parsed / 100 : parsed / 255;
		return Math.min(1, Math.max(0, normalized));
	};
	const alpha = (part: string | undefined) => {
		if (!part) return 1;
		const parsed = Number.parseFloat(part);
		if (Number.isNaN(parsed)) return null;
		const normalized = part.endsWith('%') ? parsed / 100 : parsed;
		return Math.min(1, Math.max(0, normalized));
	};
	const red = channel(parts[0]);
	const green = channel(parts[1]);
	const blue = channel(parts[2]);
	const opacity = alpha(parts[3]);
	if (red === null || green === null || blue === null || opacity === null) return null;
	return [red, green, blue, opacity];
}

type Rgb = [number, number, number];

function toHsl([red, green, blue]: Rgb): Rgb {
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const lightness = (max + min) / 2;
	const delta = max - min;
	if (delta === 0) return [0, 0, lightness];
	const saturation = delta / (1 - Math.abs(2 * lightness - 1));
	let hue: number;
	if (max === red) hue = ((green - blue) / delta) % 6;
	else if (max === green) hue = (blue - red) / delta + 2;
	else hue = (red - green) / delta + 4;
	return [(hue * 60 + 360) % 360, saturation, lightness];
}

function fromHsl([hue, saturation, lightness]: Rgb): Rgb {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = lightness - chroma / 2;
	const sector = Math.floor(hue / 60) % 6;
	const [red, green, blue] = [
		[chroma, x, 0],
		[x, chroma, 0],
		[0, chroma, x],
		[0, x, chroma],
		[x, 0, chroma],
		[chroma, 0, x]
	][sector];
	return [red + m, green + m, blue + m];
}

function format([red, green, blue]: Rgb, alpha: number): string {
	const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
	if (alpha < 1) return `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${alpha})`;
	return `#${[red, green, blue].map((value) => channel(value).toString(16).padStart(2, '0')).join('')}`;
}

/** Page-like properties turn dark; everything else is ink and turns light. */
const SURFACE_PROPERTY = /background|bgcolor|border|outline/;

/**
 * One colour for a dark page. Only lightness moves — hue and saturation stay —
 * so a navy heading becomes light blue and an orange one a lighter orange, and
 * the relationships the sender chose survive. Colours already on the dark side
 * of the page (a black header bar, white text on it) are left alone.
 */
function darkModeColour(literal: string, property: string): string {
	const parsed = rgba(literal);
	if (!parsed) return literal;
	const [red, green, blue, alpha] = parsed;
	if (alpha < 0.2) return literal;

	const [hue, saturation, lightness] = toHsl([red, green, blue]);
	if (SURFACE_PROPERTY.test(property.toLowerCase())) {
		if (lightness <= 0.45) return literal;
		// White lands on 0.10, a pale highlight a little above it; muted, so it doesn't glow.
		return format(fromHsl([hue, saturation * 0.6, 0.1 + (1 - lightness) * 0.35]), alpha);
	}
	if (lightness >= 0.55) return literal;
	// Black lands on 0.95; darker ink stays the brightest, so its emphasis survives.
	return format(fromHsl([hue, saturation, 0.95 - lightness * 0.45]), alpha);
}

/** Rewrites colours in markup and its stylesheets for a dark page; images are never touched. */
export function adaptDarkColours(source: string): string {
	const declarationsAdapted = source.replace(COLOUR_DECLARATION, (declaration, property: string) =>
		declaration.replace(COLOUR_LITERAL, (literal: string) => darkModeColour(literal, property))
	);

	return declarationsAdapted.replace(HTML_TAG, (tag) =>
		tag.replace(
			COLOUR_ATTRIBUTE,
			(attribute, _prefix: string, property: string, _quote: string, literal: string) =>
				attribute.replace(literal, darkModeColour(literal, property))
		)
	);
}
