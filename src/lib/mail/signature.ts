import {
	hasSignatureBlock,
	pickEmailSignature,
	SIGNATURE_ATTRIBUTE,
	signatureBlockHtml
} from '$lib/email-signature';
import { isHtmlEmpty } from '$lib/utils/html';
import type { MailAddress, ThreadMessage } from '$lib/types';

/** The sign-off mail from `address` carries: the address's own, else the account's. */
export function signatureFor(address: MailAddress | undefined, account: string | undefined): string {
	return pickEmailSignature(address?.signature, account);
}

/** The address a reply to `message` goes out from, as the server picks it: the one it reached. */
export function replyAddress(
	message: Pick<ThreadMessage, 'direction' | 'from_addr' | 'to_addr' | 'cc_addr'>,
	addresses: MailAddress[]
): MailAddress | undefined {
	const ours = message.direction === 'outbound' ? message.from_addr : `${message.to_addr} ${message.cc_addr ?? ''}`;
	const seen = ours.toLowerCase();
	return (
		addresses.find((address) => seen.includes(address.address.toLowerCase())) ??
		addresses.find((address) => address.is_default) ??
		addresses[0]
	);
}

function fragment(html: string): HTMLTemplateElement {
	const template = document.createElement('template');
	template.innerHTML = html;
	return template;
}

/** Puts `signature` where the old one was, or below the message when it had none. */
export function swapSignature(html: string, signature: string): string {
	const block = signatureBlockHtml(signature);
	const template = fragment(html);
	const current = template.content.querySelector(`[${SIGNATURE_ATTRIBUTE}]`);
	if (!current) return block ? `${html}<div><br></div>${block}` : html;
	if (block) current.replaceWith(fragment(block).content);
	else current.remove();
	return template.innerHTML;
}

/** True when nothing has been written apart from the signature. */
export function isBodyEmpty(html: string): boolean {
	if (!hasSignatureBlock(html)) return isHtmlEmpty(html);
	// Derived state is read during SSR too, where there is no document; the signature is last.
	if (typeof document === 'undefined') {
		return isHtmlEmpty(html.slice(0, html.indexOf(`<div ${SIGNATURE_ATTRIBUTE}`)));
	}
	const template = fragment(html);
	template.content.querySelector(`[${SIGNATURE_ATTRIBUTE}]`)?.remove();
	return isHtmlEmpty(template.innerHTML);
}
