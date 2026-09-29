/**
 * Preparing a received message for display.
 *
 * Email HTML is not page HTML. It arrives with fixed pixel heights, layout
 * tables, absolutely positioned chips and inline colours that assume a white
 * page — and it was written for a renderer that is not this app. Dropped
 * straight into the document it fights our stylesheet in both directions: our
 * line-height overflows its fixed boxes, its colours ignore our theme.
 *
 * So it is rendered inside its own document instead, and this module builds
 * that document.
 */

import { adaptDarkColours } from './email-dark';

/**
 * Did the sender style the message, or just write it? Anything styled is shown
 * the way its sender made it — on white, untouched. Only a message with no
 * styling of its own is shown in the app's colours and type, so a plain reply
 * reads like part of the thread rather than a sheet of paper dropped into it.
 */
const LAYOUT_MARKERS = [
	/<table[\s>]/i,
	/<style[\s>]/i,
	/\sbgcolor\s*=/i,
	/background(?:-color)?\s*:(?!\s*(?:transparent|none|inherit|initial|unset)\b)/i,
	/position\s*:\s*(absolute|fixed)/i,
	/<center[\s>]/i,
	/<font[\s>]/i,
	/\scolor\s*=/i
];

/** Inline declarations that mean the sender chose how it looks. */
const STYLING_PROPERTIES = ['color', 'background', 'font'];

/** Where the sender's own words end and the conversation history begins. */
const QUOTE_BOUNDARY = [
	/<blockquote/i,
	/class\s*=\s*["'][^"']*gmail_quote/i,
	/class\s*=\s*["'][^"']*yahoo_quoted/i,
	/id\s*=\s*["']?appendonsend/i,
	/id\s*=\s*["']?divRplyFwdMsg/i,
	/--\s*original message/i
];

/**
 * A reply is judged on what its sender wrote, not on what they quoted. Reply to
 * a message containing a designed element and the quote carries that markup
 * along — which would otherwise class every answer in the thread as designed.
 */
function ownContent(html: string): string {
	let cut = html.length;

	for (const marker of QUOTE_BOUNDARY) {
		const match = marker.exec(html);
		if (match && match.index < cut) cut = match.index;
	}
	// The dashes rule matches its last two dashes; the boundary starts at the first.
	while (cut > 0 && html[cut - 1] === '-') cut -= 1;

	// A bare forward is all quote and no words; judge it whole.
	return cut > 30 ? html.slice(0, cut) : html;
}

/** Where a `style=` value that starts at `start` ends: its closing quote, or for an unquoted one a space or `>`. */
function valueEnd(lower: string, start: number): number {
	const quote = lower[start];
	if (quote === '"' || quote === "'") {
		const close = lower.indexOf(quote, start + 1);
		return close === -1 ? lower.length : close;
	}
	let end = start;
	while (end < lower.length && lower[end] !== ' ' && lower[end] !== '>') end += 1;
	return end;
}

/**
 * Any `style=` attribute setting a colour, background or font. Each value is
 * read once and the scan resumes after it, so it stays linear however many
 * there are — a regex over this would not.
 */
function hasInlineStyling(html: string): boolean {
	const lower = html.toLowerCase();
	const skipSpaces = (index: number) => {
		while (index < lower.length && /\s/.test(lower[index])) index += 1;
		return index;
	};
	let at = lower.indexOf('style');
	while (at !== -1) {
		// HTML allows space on either side of the `=`: \`style = "color: red"\`.
		const equals = skipSpaces(at + 'style'.length);
		let next = at + 'style'.length;
		if (lower[equals] === '=') {
			const start = skipSpaces(equals + 1);
			const end = valueEnd(lower, start);
			if (STYLING_PROPERTIES.some((property) => lower.slice(start, end).includes(property))) return true;
			next = Math.max(end, start);
		}
		at = lower.indexOf('style', next);
	}
	return false;
}

export function isRichHtml(html: string): boolean {
	const own = ownContent(html);
	return LAYOUT_MARKERS.some((marker) => marker.test(own)) || hasInlineStyling(own);
}

/**
 * Did the sender design a dark version? Theirs is shown in dark mode when so;
 * otherwise the message keeps its light page. A bare `color-scheme`
 * declaration does not count: it opts into the client adapting the message,
 * not into colours the sender picked.
 */
export function supportsDarkScheme(html: string): boolean {
	return /@media[^{]{0,240}\(\s*prefers-color-scheme\s*:\s*dark\s*\)|light-dark\s*\(/i.test(html);
}

/**
 * What the frame itself depends on — sizing from outside, no inner scrollbars,
 * the quote toggle. It goes last in the head, so nothing a sender writes can
 * undo it.
 */
const FRAME_CSS = `
/* The frame is sized to its content from the outside, so percentage heights
   inside would feed back into that measurement. */
html, body { height: auto !important; }
/* A frame paints an opaque white canvas unless the document opts out, which is
   what put a white sheet under plain replies. A transparent background alone is
   not enough: a frame whose colour scheme differs from its embedder's is denied
   transparency and painted in its own scheme instead, so the plain styles below
   declare a scheme of their own to match. */
/* Safari inflates text in a frame on its own judgement; keep the sizes set. */
html { overflow-x: auto; overflow-y: hidden; background: transparent; -webkit-text-size-adjust: 100%; }
body { margin: 0; }
/* Set from outside the frame; the control that clears it lives out there too. */
.quote-hidden { display: none !important; }
`;

/**
 * A message with no styling of its own: the app's type and colours. Nothing of
 * the sender's is lost, since there was nothing of theirs to begin with.
 */
const SIMPLE_CSS = `
body {
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
	font-size: 15px;
	line-height: 1.65;
	overflow-wrap: anywhere;
}
p { margin: 0 0 1em; }
/* Tailwind's reset is not in here, but senders still rely on markers. */
ul { list-style: disc outside; margin: 0.5em 0; padding-left: 1.5em; }
ol { list-style: decimal outside; margin: 0.5em 0; padding-left: 1.5em; }
pre { white-space: pre-wrap; }
img, video, svg { max-width: 100%; height: auto; }
table { max-width: 100%; }

html:not([data-theme='dark']) { color-scheme: light; }
body { color: #525252; background: transparent; }
a { color: #4f6b58; }
blockquote { border-color: rgba(0, 0, 0, 0.12) !important; }

/* Dark mode. Plain text written on a white page is near-black, which has to
   give way to the theme's own or it is unreadable here. */
:root[data-theme='dark'] { color-scheme: dark; }
:root[data-theme='dark'] body { color: #a8a8b3 !important; background-color: transparent !important; }
:root[data-theme='dark'] body *:not(a) {
	color: inherit !important;
	background-color: transparent !important;
	background-image: none !important;
}
:root[data-theme='dark'] a { color: #a8c2b0 !important; }
:root[data-theme='dark'] blockquote { border-color: rgba(255, 255, 255, 0.16) !important; }
`;

/**
 * A styled message gets only what it may be assuming a client provides: a
 * white page, dark text and a plain font. These go in *ahead* of the sender's
 * own head, so any stylesheet of theirs wins — our rules are the fallback, never
 * the override. Its colours are never rewritten: a sender who wrote no dark
 * version is shown on its light page in dark mode too, as Gmail does, because
 * recolouring parts one by one loses the relationships between them.
 */
const STYLED_DEFAULTS_CSS = `
body { padding: 18px 20px; font: 14px/1.5 Arial, Helvetica, sans-serif; }
`;

/**
 * No dark version: the light page is declared outright rather than through
 * \`prefers-color-scheme\`, which inside a frame follows different things in
 * different browsers — and a dark canvas under colours written for white is
 * unreadable.
 */
const LIGHT_PAGE_CSS = `
html { color-scheme: light; }
body { color: #202124; background: #ffffff; }
`;

/** The sender ships a dark version; the page follows the theme and theirs paints over it. */
/** Recoloured for a dark page: the page the colours now sit on, and ink for text that set none. */
const ADAPTED_PAGE_CSS = `
html { color-scheme: dark; }
body { color: #e4e4e7; background: transparent; }
`;

const SCHEME_PAGE_CSS = `
@media (prefers-color-scheme: light) {
	html { color-scheme: light; }
	body { color: #202124; background: #ffffff; }
}
@media (prefers-color-scheme: dark) {
	html { color-scheme: dark; }
}
`;

/** The stylesheet that goes last: the frame's rules, plus the app's look for a plain message. */
export function emailCss(rich: boolean): string {
	return rich ? FRAME_CSS : FRAME_CSS + SIMPLE_CSS;
}

/** Marks our stylesheet so a later pass can tell it is already in place. */
export const EMAIL_STYLE_ID = '__mail-frame-style';

/** Senders differ on whether the HTML part is a fragment or a whole document. */
function isFullDocument(html: string): boolean {
	return /<html[\s>]/i.test(html) || /<body[\s>]/i.test(html);
}

/**
 * The frame is already scriptless by sandbox; this closes off the rest —
 * subresources, embedded frames, form posts. It goes in ahead of anything the
 * sender wrote, because a policy only governs what follows it.
 *
 * Fonts are denied along with everything else, so a message using a hosted
 * webface falls back to the stack below rather than announcing the open to
 * whoever hosts it.
 */
const CSP =
	"default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; " +
	"font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; " +
	"form-action 'none'; base-uri 'none'";

/** A styled message's fallbacks; a plain one gets none, since everything it needs comes last. */
function pageCss(html: string, adapted: boolean): string {
	if (supportsDarkScheme(html)) return SCHEME_PAGE_CSS;
	return adapted ? ADAPTED_PAGE_CSS : LIGHT_PAGE_CSS;
}

function headStart(html: string, rich: boolean, adapted: boolean): string {
	const defaults = rich ? `<style>${STYLED_DEFAULTS_CSS}${pageCss(html, adapted)}</style>` : '';
	return `<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">${defaults}`;
}

/**
 * `base target=_blank` keeps links from trying to navigate the app, which the
 * sandbox would block outright. The viewport matters most on iOS, where a
 * document without one is laid out at a 980px default and comes out shrunken.
 */
function headEnd(rich: boolean): string {
	return `<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style id="${EMAIL_STYLE_ID}">${emailCss(rich)}</style>`;
}

/**
 * `before` goes in ahead of the sender's own head so it governs it; `after`
 * goes in last so our rules outrank theirs.
 */
function spliceHead(html: string, before: string, after: string): string {
	const open = /<head\b[^>]*>/i.exec(html);
	if (open) {
		const at = open.index + open[0].length;
		const withBefore = html.slice(0, at) + before + html.slice(at);

		const closing = withBefore.search(/<\/head\s*>/i);
		return closing === -1
			? withBefore + after
			: withBefore.slice(0, closing) + after + withBefore.slice(closing);
	}

	const root = /<html\b[^>]*>/i.exec(html);
	if (root) {
		const at = root.index + root[0].length;
		return `${html.slice(0, at)}<head>${before}${after}</head>${html.slice(at)}`;
	}

	// A <body> with no <html> around it; give it a root to hang the theme on.
	return `<html><head>${before}${after}</head>${html}`;
}

/** Ours wins: a sender carrying its own data-theme would otherwise pick ours. */
function withTheme(html: string, theme: string): string {
	return html.replace(
		/<html\b[^>]*/i,
		(tag) => `${tag.replace(/\sdata-theme\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, '')} data-theme="${theme}"`
	);
}

/**
 * Would this message be recoloured for the dark theme? Only a styled one whose
 * sender wrote no dark version — and only until the reader asks for the original.
 */
export function adaptsToDark(html: string, options: { rich: boolean; theme?: string; original?: boolean }): boolean {
	return options.rich && options.theme === 'dark' && !options.original && !supportsDarkScheme(html);
}

export function buildEmailDocument(
	html: string,
	options: { rich: boolean; theme?: string; original?: boolean }
): string {
	const theme = options.theme ?? 'light';
	const adapted = adaptsToDark(html, options);
	const before = headStart(html, options.rich, adapted);
	const after = headEnd(options.rich);
	const body = adapted ? adaptDarkColours(html) : html;

	// A complete document cannot be nested inside another one — that drops its
	// <head>, and with it any <style> the layout needs. Our own assets are
	// spliced into the head it already has instead. Doing this here rather than
	// after load matters in dark mode: the colour scheme and the transparency
	// opt-out have to be in the very first paint, or the message flashes up as a
	// white sheet while it waits for script.
	if (isFullDocument(body)) return withTheme(spliceHead(body, before, after), theme);

	return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
${before}
${after}
</head><body>${body}</body></html>`;
}
