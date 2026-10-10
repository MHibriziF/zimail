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

/** Where inline `cid:` images are served from once resolveInlineImages has pointed them at their attachment. */
const INLINE_IMAGE_PATH = '/api/mail/';

export type EmailDocumentOptions = {
	rich: boolean;
	theme?: string;
	original?: boolean;
	/** The reader asked to see this message's remote images. */
	remote?: boolean;
	/** The app's origin, so inline images can be allowed by path rather than all of it. */
	origin?: string;
};

/**
 * The frame is already scriptless by sandbox; this closes off the rest —
 * subresources, embedded frames, form posts. It goes in ahead of anything the
 * sender wrote, because a policy only governs what follows it.
 *
 * Remote images stay blocked until the reader asks: a tracking pixel or a CSS
 * background tells its sender when the message was opened, and from where.
 * Inline images are the message's own attachments, served by the app.
 *
 * Fonts are denied along with everything else, so a message using a hosted
 * webface falls back to the stack below rather than announcing the open to
 * whoever hosts it.
 */
export function emailCsp(options: Pick<EmailDocumentOptions, 'remote' | 'origin'> = {}): string {
	const inline = options.origin ? `${options.origin}${INLINE_IMAGE_PATH}` : "'self'";
	const remote = options.remote ? ' https: http:' : '';
	return (
		`default-src 'none'; img-src data: ${inline}${remote}; style-src 'unsafe-inline'; ` +
		"font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; " +
		"form-action 'none'; base-uri 'none'"
	);
}

/** Attributes that load an image the moment the message is shown. */
const LOADING_ATTRIBUTES = ['src', 'srcset', 'background', 'poster'];

const REMOTE_URL = /^(?:https?:)?\/\//i;

function isAttributeStart(lower: string, at: number): boolean {
	return at === 0 || /[\s"'/]/.test(lower[at - 1]);
}

function skipSpaces(text: string, at: number): number {
	let index = at;
	while (index < text.length && /\s/.test(text[index])) index += 1;
	return index;
}

function isQuote(character: string | undefined): boolean {
	return character === '"' || character === "'";
}

/** The attribute `name` written at `at`, if it is one: its value without quotes, and where the scan resumes. */
function attributeAt(lower: string, name: string, at: number): { value: string; end: number } | null {
	if (!isAttributeStart(lower, at)) return null;
	const equals = skipSpaces(lower, at + name.length);
	if (lower[equals] !== '=') return null;
	const start = skipSpaces(lower, equals + 1);
	const end = valueEnd(lower, start);
	const valueStart = isQuote(lower[start]) ? start + 1 : start;
	return { value: lower.slice(valueStart, end), end: Math.max(end, start) };
}

function isRemoteValue(name: string, value: string): boolean {
	const urls = name === 'srcset' ? value.split(',') : [value];
	return urls.some((url) => REMOTE_URL.test(url.trim()));
}

function remoteAttribute(lower: string, name: string): boolean {
	let at = lower.indexOf(name);
	while (at !== -1) {
		const attribute = attributeAt(lower, name, at);
		if (attribute && isRemoteValue(name, attribute.value)) return true;
		at = lower.indexOf(name, attribute ? attribute.end : at + name.length);
	}
	return false;
}

function remoteStyleUrl(lower: string): boolean {
	let at = lower.indexOf('url(');
	while (at !== -1) {
		const close = lower.indexOf(')', at + 4);
		const value = lower.slice(at + 4, close === -1 ? at + 256 : close);
		if (REMOTE_URL.test(value.trim().replace(/^["']/, '').trim())) return true;
		at = lower.indexOf('url(', at + 4);
	}
	return false;
}

/**
 * Would the message load anything from elsewhere if allowed to? Decides whether
 * the reader is offered "Show images" at all. A miss only means no offer — the
 * policy still blocks it — so this errs towards being simple.
 */
export function hasRemoteContent(html: string): boolean {
	const lower = html.toLowerCase();
	return LOADING_ATTRIBUTES.some((name) => remoteAttribute(lower, name)) || remoteStyleUrl(lower);
}

/** A styled message's fallbacks; a plain one gets none, since everything it needs comes last. */
function pageCss(html: string, adapted: boolean): string {
	if (supportsDarkScheme(html)) return SCHEME_PAGE_CSS;
	return adapted ? ADAPTED_PAGE_CSS : LIGHT_PAGE_CSS;
}

function headStart(html: string, options: EmailDocumentOptions, adapted: boolean): string {
	const defaults = options.rich ? `<style>${STYLED_DEFAULTS_CSS}${pageCss(html, adapted)}</style>` : '';
	return `<meta http-equiv="Content-Security-Policy" content="${emailCsp(options)}">
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
 * The sender's doctype decides between standards and quirks layout, so it has
 * to stay first. Only comments may come before it; a doctype ends at its first
 * `>` whatever quotes it holds, exactly as the parser reads it.
 */
function splitDoctype(html: string): { doctype: string; rest: string } {
	let at = 0;
	for (;;) {
		while (at < html.length && /\s/.test(html[at])) at += 1;
		if (!html.startsWith('<!--', at)) break;
		const close = html.indexOf('-->', at + 4);
		if (close === -1) return { doctype: '', rest: html };
		at = close + 3;
	}
	if (html.slice(at, at + 9).toLowerCase() !== '<!doctype') return { doctype: '', rest: html };
	const end = html.indexOf('>', at);
	if (end === -1) return { doctype: '', rest: html };
	return { doctype: html.slice(at, end + 1), rest: html.slice(0, at) + html.slice(end + 1) };
}

/** Elements whose content is text to the parser, so a tag written inside one is not a tag. */
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes']);

const TAG_OPEN = /^<(\/?)([a-z][^\s/>]*)/i;

/** The `>` that closes a tag opened before `from`, stepping over quoted attribute values. */
function tagEnd(html: string, from: number): number {
	let at = from;
	while (at < html.length && html[at] !== '>') {
		const next = html[at] === '=' ? skipQuoted(html, at) : at;
		if (next === -1) return -1;
		at = next + 1;
	}
	return at < html.length ? at : -1;
}

/** From an `=`: the closing quote of the value after it, its first character when unquoted, or -1 when never closed. */
function skipQuoted(html: string, equals: number): number {
	const start = skipSpaces(html, equals + 1);
	return isQuote(html[start]) ? html.indexOf(html[start], start + 1) : start;
}

/** Past a `<!--` comment at `at`, or -1 when it never closes. */
function skipComment(lower: string, at: number): number {
	const close = lower.indexOf('-->', at + 4);
	return close === -1 ? -1 : close + 3;
}

const BOGUS_COMMENT_OPENERS = new Set(['!', '?', '/']);

/** Past a `<` that opens no tag: a comment, a bogus comment (`<!…>`, `<?…>`, `</ …>`), or plain text. */
function skipNonTag(lower: string, at: number): number {
	if (lower.startsWith('<!--', at)) return skipComment(lower, at);
	if (!BOGUS_COMMENT_OPENERS.has(lower[at + 1])) return at + 1;
	const end = lower.indexOf('>', at);
	return end === -1 ? -1 : end + 1;
}

/** Past a tag at `at`, and past its content too when that content is raw text. */
function skipTag(lower: string, at: number, [token, slash, name]: RegExpExecArray): number {
	const end = tagEnd(lower, at + token.length);
	if (end === -1) return -1;
	return slash !== '/' && RAW_TEXT.has(name) ? lower.indexOf(`</${name}`, end + 1) : end + 1;
}

function endsHead([, slash, name]: RegExpExecArray): boolean {
	return slash === '/' ? name === 'head' : name === 'body';
}

/**
 * Where the sender's head ends — its `</head>`, or the `<body>` that ends it
 * implicitly — read the way a parser would, so the same text inside a comment,
 * an attribute value or a `<style>` does not count. -1 when there is none.
 */
function senderHeadEnd(html: string): number {
	const lower = html.toLowerCase();
	let at = lower.indexOf('<');
	while (at !== -1) {
		const open = TAG_OPEN.exec(lower.slice(at, at + 64));
		if (open && endsHead(open)) return at;
		if (open?.[2] === 'plaintext') return -1;
		const after = open ? skipTag(lower, at, open) : skipNonTag(lower, at);
		if (after === -1) return -1;
		at = lower.indexOf('<', after);
	}
	return -1;
}

/**
 * A complete document from the sender is wrapped, never spliced into: our own
 * `<html>` and `<head>` open the document with the policy as the very first
 * thing in it, so nothing the sender wrote can come ahead of it or swallow it
 * (a `<head>` inside a comment once did exactly that). The parser folds the
 * sender's own `<html>` and `<head>` into ours — their `<html>` attributes are
 * kept where ours does not set the same one, so our `data-theme` wins — and
 * their head content follows our defaults, so their styles outrank those.
 * `after` goes where their head ends, so the frame's rules come last.
 */
function wrapDocument(html: string, theme: string, before: string, after: string): string {
	const { doctype, rest } = splitDoctype(html);
	const end = senderHeadEnd(rest);
	const sender = end === -1 ? rest + after : rest.slice(0, end) + after + rest.slice(end);
	return `${doctype}<html data-theme="${theme}"><head>${before}${sender}`;
}

/**
 * Would this message be recoloured for the dark theme? Only a styled one whose
 * sender wrote no dark version — and only until the reader asks for the original.
 */
export function adaptsToDark(html: string, options: { rich: boolean; theme?: string; original?: boolean }): boolean {
	return options.rich && options.theme === 'dark' && !options.original && !supportsDarkScheme(html);
}

export function buildEmailDocument(html: string, options: EmailDocumentOptions): string {
	const theme = options.theme ?? 'light';
	const adapted = adaptsToDark(html, options);
	const before = headStart(html, options, adapted);
	const after = headEnd(options.rich);
	const body = adapted ? adaptDarkColours(html) : html;

	// A complete document cannot be nested inside another one — that drops its
	// <head>, and with it any <style> the layout needs. Its head is merged into
	// ours by the parser instead (see wrapDocument). Doing this here rather than
	// after load matters in dark mode: the colour scheme and the transparency
	// opt-out have to be in the very first paint, or the message flashes up as a
	// white sheet while it waits for script.
	if (isFullDocument(body)) return wrapDocument(body, theme, before, after);

	return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
${before}
${after}
</head><body>${body}</body></html>`;
}
