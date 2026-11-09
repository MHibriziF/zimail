import type {
	Comment,
	Element,
	HTMLRewriter as WorkersHTMLRewriter,
	Response as WorkersResponse
} from '@cloudflare/workers-types';
import { assertSignatureLength, signatureAsHtml } from '$lib/email-signature';
import { signatureAttribute, signatureTagRule } from '$lib/signature-html';

/** A Workers global (bun has it too, for tests), which the app's DOM-based types don't declare. */
declare const HTMLRewriter: typeof WorkersHTMLRewriter;

function cleanElement(element: Element) {
	const rule = signatureTagRule(element.tagName);
	if (rule === 'drop') {
		element.remove();
		return;
	}
	if (rule === 'unwrap') {
		element.removeAndKeepContent();
		return;
	}
	// A copy, because removing attributes while iterating the live list could skip some.
	const attributes = Array.from(element.attributes);
	for (const [name, value] of attributes) {
		const kept = signatureAttribute(name, value);
		if (kept === null) element.removeAttribute(name);
		else if (kept !== value) element.setAttribute(name, kept);
	}
	if (element.tagName === 'img' && !element.hasAttribute('src')) element.remove();
	// A link whose address was unsafe is just its text now, not something that looks clickable.
	else if (element.tagName === 'a' && !element.hasAttribute('href')) element.removeAndKeepContent();
	else if (element.tagName === 'a' && element.hasAttribute('target')) element.setAttribute('rel', 'noopener');
}

/**
 * A tag cut off at the end comes through as text, which is harmless alone but becomes a live tag
 * once the composer writes `</div>` after it. Escaping its `<` keeps it text.
 */
function escapeUnfinishedTag(html: string): string {
	const open = html.lastIndexOf('<');
	return open > html.lastIndexOf('>') ? `${html.slice(0, open)}&lt;${html.slice(open + 1)}` : html;
}

/** A signature reduced to the tags, attributes and links in `$lib/signature-html`. */
export async function sanitizeSignatureHtml(html: string): Promise<string> {
	const rewriter = new HTMLRewriter().on('*', { element: cleanElement }).onDocument({
		comments(comment: Comment) {
			comment.remove();
		}
	});
	const source = new Response(html) as unknown as WorkersResponse;
	return escapeUnfinishedTag((await rewriter.transform(source).text()).trim());
}

/** A signature as it is stored: length-checked, as HTML, sanitized. Throws when it is too long. */
export async function cleanSignature(value: string): Promise<string> {
	assertSignatureLength(value);
	return sanitizeSignatureHtml(signatureAsHtml(value));
}
