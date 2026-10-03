export const MAX_EMAIL_SIGNATURE_LENGTH = 1000;

/** Keep intentional line breaks while removing transport and trailing whitespace noise. */
export function normalizeEmailSignature(value: string): string {
	return value
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.trim();
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** Mailbox sign-off wins when set; otherwise the account signature. */
export function pickEmailSignature(
	mailbox: string | null | undefined,
	account: string | null | undefined
): string {
	return normalizeEmailSignature(mailbox ?? '') || normalizeEmailSignature(account ?? '');
}

/** Empty input becomes null so the mailbox falls back to the account signature. */
export function parseMailboxSignature(value: string): string | null {
	const signature = normalizeEmailSignature(value);
	if (signature.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		throw new Error(`Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer`);
	}
	return signature || null;
}

/** Marks the signature in a body, so the composer can find it again to swap or skip it. */
export const SIGNATURE_ATTRIBUTE = 'data-email-signature';

/** The signature as the composer shows it and sent mail carries it; empty when there is none. */
export function signatureBlockHtml(signature: string): string {
	const normalized = normalizeEmailSignature(signature);
	if (!normalized) return '';
	return `<div ${SIGNATURE_ATTRIBUTE}="true">${escapeHtml(normalized).replaceAll('\n', '<br>\n')}</div>`;
}

export function hasSignatureBlock(html: string): boolean {
	return html.includes(SIGNATURE_ATTRIBUTE);
}

/** A body for a fresh composer: an empty line to write on, then the signature below it. */
export function composerBody(signature: string, body = ''): string {
	const block = signatureBlockHtml(signature);
	if (!block) return body;
	return `${body || '<div><br></div>'}<div><br></div>${block}`;
}

/** Append the configured sign-off to both MIME alternatives exactly once at send time. */
export function appendEmailSignature(input: {
	text: string;
	html: string | null;
	signature: string;
}): { text: string; html: string | null } {
	const signature = normalizeEmailSignature(input.signature);
	if (!signature) return { text: input.text, html: input.html };

	const text = `${input.text.trimEnd()}\n\n${signature}`;
	const html = input.html
		? `${input.html.trimEnd()}\n<div><br></div>\n${signatureBlockHtml(signature)}`
		: null;

	return { text, html };
}
