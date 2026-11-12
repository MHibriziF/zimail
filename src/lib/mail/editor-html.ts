import { isFullDocument } from '$lib/utils/email-html';

/** Tags the rich editor can't hold: in the app's own page they would run, load, or restyle the app. */
const DROPPED_TAGS = ['script', 'style', 'link', 'meta', 'title', 'base', 'iframe', 'frame', 'object', 'embed', 'form'];

const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'xlink:href'];
const UNSAFE_SCHEMES = ['javascript:', 'vbscript:'];

/**
 * True when the HTML only survives as written outside the rich editor: a whole page, or `<style>`
 * rules. The editor would drop them, so such a body stays in HTML mode.
 */
export function needsHtmlMode(html: string): boolean {
	return isFullDocument(html) || /<style[\s>]/i.test(html);
}

function isUnsafeUrl(value: string): boolean {
	// Browsers ignore control characters and spaces inside a scheme, so `java\tscript:` still runs.
	const compact = [...value].filter((char) => char.charCodeAt(0) > 32).join('').toLowerCase();
	return UNSAFE_SCHEMES.some((scheme) => compact.startsWith(scheme));
}

function cleanAttributes(element: Element) {
	for (const { name, value } of Array.from(element.attributes)) {
		const lower = name.toLowerCase();
		if (lower.startsWith('on') || (URL_ATTRIBUTES.includes(lower) && isUnsafeUrl(value))) {
			element.removeAttribute(name);
		}
	}
}

/**
 * Hand-written HTML cut down to what the rich editor can safely show. It is the app's own page, so
 * scripts, handlers and styles would act on the app rather than the message. DOMParser builds an
 * inert document, so nothing here runs while it is cleaned.
 */
export function richEditorHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	for (const element of doc.body.querySelectorAll(DROPPED_TAGS.join(','))) element.remove();
	for (const element of doc.body.querySelectorAll('*')) cleanAttributes(element);
	return doc.body.innerHTML;
}
