/**
 * What a signature may contain. The server enforces it on save (`sanitizeSignatureHtml`) and the
 * signature editor on paste (`cleanPastedHtml`), because the composer puts a signature straight
 * into the page, outside the sandbox that shows received mail.
 */

/** Kept, with their content. Anything else is unwrapped: its content stays, the tag goes. */
const KEPT_TAGS = new Set([
	'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'small', 'sub', 'sup', 'br', 'hr',
	'p', 'div', 'span', 'font', 'center', 'blockquote', 'pre', 'code',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'img',
	'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col'
]);

/** Removed with everything inside them. */
const DROPPED_TAGS = new Set([
	'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript',
	'template', 'svg', 'math', 'head', 'title', 'meta', 'link', 'base', 'form', 'input',
	'button', 'select', 'option', 'textarea', 'audio', 'video', 'source', 'track', 'canvas'
]);

const KEPT_ATTRIBUTES = new Set([
	'href', 'src', 'alt', 'title', 'width', 'height', 'style', 'align', 'valign', 'color', 'face',
	'size', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'colspan', 'rowspan', 'dir', 'target'
]);

/** Fragments that let CSS run code or fetch something; a style holding one is dropped whole. */
const UNSAFE_STYLE = ['expression', 'javascript:', 'url(', '@import', 'behavior', '-moz-binding', '\\'];

const LINK_SCHEMES = ['http://', 'https://', 'mailto:', 'tel:'];
const IMAGE_SCHEMES = ['https://', 'http://'];

export type SignatureTagRule = 'keep' | 'drop' | 'unwrap';

/** Tags a pasted page brings along that a signature unwraps rather than keeps. */
const COMMON_PAGE_TAGS = new Set(['html', 'body', 'section', 'article', 'header', 'footer', 'main', 'nav', 'label', 'o:p']);

/** An HTML tag name, as opposed to `<ana@x.co>` or `<3`. */
export function isHtmlTagName(name: string): boolean {
	const lower = name.toLowerCase();
	return KEPT_TAGS.has(lower) || DROPPED_TAGS.has(lower) || COMMON_PAGE_TAGS.has(lower);
}

export function signatureTagRule(tag: string): SignatureTagRule {
	const name = tag.toLowerCase();
	if (KEPT_TAGS.has(name)) return 'keep';
	return DROPPED_TAGS.has(name) ? 'drop' : 'unwrap';
}

function hasScheme(value: string, schemes: string[]): boolean {
	// Browsers ignore control characters and spaces inside a scheme, so `java\tscript:` must not slip by.
	let compact = '';
	for (const char of value.trim().toLowerCase()) if (char > ' ') compact += char;
	return schemes.some((scheme) => compact.startsWith(scheme));
}

/** The value to keep for an attribute, or null to remove it. */
export function signatureAttribute(name: string, value: string): string | null {
	const attribute = name.toLowerCase();
	if (!KEPT_ATTRIBUTES.has(attribute)) return null;
	if (attribute === 'href') return hasScheme(value, LINK_SCHEMES) ? value.trim() : null;
	if (attribute === 'src') return hasScheme(value, IMAGE_SCHEMES) ? value.trim() : null;
	if (attribute === 'style') {
		const lower = value.toLowerCase();
		return UNSAFE_STYLE.some((fragment) => lower.includes(fragment)) ? null : value;
	}
	if (attribute === 'target') return '_blank';
	return value;
}
