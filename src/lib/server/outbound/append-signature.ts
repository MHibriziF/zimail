import { normalizeEmailSignature, signatureBlockHtml } from '$lib/email-signature';
import { stripHtml } from '../util/html';

/** Appends the signature to both MIME alternatives, for sends that didn't already show it. */
export function appendEmailSignature(input: {
	text: string;
	html: string | null;
	signature: string;
}): { text: string; html: string | null } {
	const signature = normalizeEmailSignature(input.signature);
	if (!signature) return { text: input.text, html: input.html };

	const text = `${input.text.trimEnd()}\n\n${stripHtml(signature)}`;
	const html = input.html
		? `${input.html.trimEnd()}\n<div><br></div>\n${signatureBlockHtml(signature)}`
		: null;

	return { text, html };
}
