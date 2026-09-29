/**
 * Last touches to a rendered page's <head>, applied in `hooks.server.ts`.
 *
 * `app.html` carries a fallback <title> so client-rendered pages (the meeting
 * page is `ssr = false`) still have one. A page that sets its own title must
 * not end up with two: link-preview scrapers such as WhatsApp's read from the
 * first <title> to the last </title> and show the markup in between.
 */
export const FALLBACK_TITLE_TAG = '<title id="fallback-title">';

export type PreviewDefaults = {
	/** Absolute URL: scrapers don't resolve relative ones. */
	image: string;
	siteName: string;
	/** Title for a page that sets none, in place of the app name. */
	fallbackTitle?: string;
};

const escapeAttribute = (value: string) => value.replaceAll('"', '&quot;');

/** The whole fallback element, or null when the page has none. */
function fallbackElement(html: string): string | null {
	const start = html.indexOf(FALLBACK_TITLE_TAG);
	if (start === -1) return null;
	const end = html.indexOf('</title>', start);
	return end === -1 ? null : html.slice(start, end + '</title>'.length);
}

function titleText(html: string): string {
	const open = html.indexOf('<title');
	if (open === -1) return '';
	const start = html.indexOf('>', open) + 1;
	const end = html.indexOf('</title>', start);
	return end === -1 ? '' : html.slice(start, end).trim();
}

/** Leaves exactly one <title>: the page's own, or the fallback (retitled when asked). */
export function settleTitle(html: string, fallbackTitle?: string): string {
	const fallback = fallbackElement(html);
	if (!fallback) return html;
	// Only the head counts: an inline SVG in the body can have a <title> of its own.
	const headEnd = html.indexOf('</head>');
	const head = headEnd === -1 ? html : html.slice(0, headEnd);
	if (head.replace(fallback, '').includes('<title')) return html.replace(fallback, '');
	// A function, so a `$&` or `$'` in the title is text rather than a replacement pattern.
	return fallbackTitle ? html.replace(fallback, () => `${FALLBACK_TITLE_TAG}${fallbackTitle}</title>`) : html;
}

/** Adds whichever of the basic Open Graph tags the page didn't set itself. */
export function addPreviewTags(html: string, defaults: PreviewDefaults): string {
	const headEnd = html.indexOf('</head>');
	if (headEnd === -1) return html;
	const head = html.slice(0, headEnd);
	const has = (property: string) => head.includes(`property="${property}"`);

	const tags: string[] = [];
	const title = titleText(head);
	if (!has('og:title') && title) tags.push(`<meta property="og:title" content="${escapeAttribute(title)}" />`);
	if (!has('og:site_name')) tags.push(`<meta property="og:site_name" content="${escapeAttribute(defaults.siteName)}" />`);
	if (!has('og:type')) tags.push('<meta property="og:type" content="website" />');
	if (!has('og:image')) tags.push(`<meta property="og:image" content="${escapeAttribute(defaults.image)}" />`);
	if (!head.includes('name="twitter:card"')) tags.push('<meta name="twitter:card" content="summary" />');
	if (tags.length === 0) return html;
	return `${head}\t${tags.join('\n\t\t')}\n\t${html.slice(headEnd)}`;
}

/** Both steps, for a chunk that may or may not contain the head. */
export function finishHead(html: string, defaults: PreviewDefaults): string {
	if (!html.includes('</head>')) return html;
	return addPreviewTags(settleTitle(html, defaults.fallbackTitle), defaults);
}
