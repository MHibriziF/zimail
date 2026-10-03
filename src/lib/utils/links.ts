const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

/**
 * Turns what someone typed into a link the editor may insert, or null. A bare address gets
 * `https://` and a bare email `mailto:`; anything that would run or embed (`javascript:`,
 * `data:`) is refused.
 */
export function normalizeLinkUrl(input: string): string | null {
	const value = input.trim();
	if (!value || /\s/.test(value)) return null;

	let candidate = value;
	if (!HAS_SCHEME.test(value)) {
		candidate = EMAIL.test(value) ? `mailto:${value}` : `https://${value.replace(/^\/+/, '')}`;
	}

	try {
		const url = new URL(candidate);
		if (!ALLOWED_SCHEMES.has(url.protocol)) return null;
		if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname.includes('.')) {
			return url.hostname === 'localhost' ? url.href : null;
		}
		return url.protocol === 'mailto:' || url.protocol === 'tel:' ? candidate : url.href;
	} catch {
		return null;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** An anchor safe to hand to `insertHTML`; `url` must already be normalized. */
export function linkHtml(url: string, text: string): string {
	return `<a href="${escapeHtml(url)}">${escapeHtml(text || url)}</a>`;
}
