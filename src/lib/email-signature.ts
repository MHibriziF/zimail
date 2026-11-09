import { isHtmlTagName } from './signature-html';

/** Signatures are HTML: a logo, links and a table add up quickly, so this is generous. */
export const MAX_EMAIL_SIGNATURE_LENGTH = 10_000;

/** Remove transport line endings and the whitespace around the signature. */
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

function isNameChar(char: string): boolean {
	const lower = char.toLowerCase();
	return (lower >= 'a' && lower <= 'z') || (char >= '0' && char <= '9') || char === ':';
}

/** The tag name after the `<` at `open`, skipping the `/` of a closing tag. */
function tagNameAt(value: string, open: number): string {
	let index = open + 1;
	if (value[index] === '/') index += 1;
	let name = '';
	while (index < value.length && isNameChar(value[index])) name += value[index++];
	return name;
}

/** True when `value` contains real markup, rather than text such as `<3` or `Ana <ana@x.co>`. */
function looksLikeHtml(value: string): boolean {
	for (let open = value.indexOf('<'); open !== -1; open = value.indexOf('<', open + 1)) {
		if (value.startsWith('<!--', open) || isHtmlTagName(tagNameAt(value, open))) return true;
	}
	return false;
}

/**
 * A signature as HTML. The settings editor sends HTML; an API client may still send plain text,
 * as every signature was before, so text keeps its line breaks instead of running together.
 */
export function signatureAsHtml(value: string): string {
	const normalized = normalizeEmailSignature(value);
	return looksLikeHtml(normalized) ? normalized : escapeHtml(normalized).replaceAll('\n', '<br>');
}

/** Mailbox sign-off wins when set; otherwise the account signature. */
export function pickEmailSignature(
	mailbox: string | null | undefined,
	account: string | null | undefined
): string {
	return normalizeEmailSignature(mailbox ?? '') || normalizeEmailSignature(account ?? '');
}

export function assertSignatureLength(value: string): void {
	if (value.length > MAX_EMAIL_SIGNATURE_LENGTH) {
		throw new Error(`Signature must be ${MAX_EMAIL_SIGNATURE_LENGTH} characters or fewer`);
	}
}

/** Marks the signature in a body, so the composer can find it again to swap or skip it. */
export const SIGNATURE_ATTRIBUTE = 'data-email-signature';

/**
 * The signature as the composer shows it and sent mail carries it; empty when there is none.
 * Stored signatures are already sanitized, so they go in as they are.
 */
export function signatureBlockHtml(signature: string): string {
	const normalized = normalizeEmailSignature(signature);
	if (!normalized) return '';
	return `<div ${SIGNATURE_ATTRIBUTE}="true">${normalized}</div>`;
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
