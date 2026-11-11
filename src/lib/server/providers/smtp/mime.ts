import type { OutboundAttachmentInput } from '$lib/types';

/**
 * Raw RFC 5322 / MIME for SMTP. Every part is base64 in 76-character CRLF
 * lines, so the problems relays reject mail for can't happen: bare LF, lines
 * over 998 characters, or 8-bit text sent as 7bit. Non-ASCII header text is
 * RFC 2047 (each encoded word stays within 75 characters) and filenames are
 * RFC 2231.
 *
 * Bcc never appears here. It goes only in the SMTP envelope, or every
 * recipient would see it.
 */
export type MimeInput = {
	from: { address: string; name?: string };
	to: string[];
	cc?: string[];
	replyTo?: string;
	subject: string;
	text: string;
	html?: string;
	/** Extra headers, e.g. In-Reply-To and References. */
	headers?: Record<string, string>;
	attachments?: OutboundAttachmentInput[];
	/** Without angle brackets. */
	messageId: string;
	date: Date;
	/** For tests; random otherwise. */
	boundary?: () => string;
};

const CRLF = '\r\n';
const encoder = new TextEncoder();

/** Headers this builder writes itself, so a caller can't duplicate or override them. */
const OWN_HEADERS = new Set(['from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date', 'message-id', 'mime-version', 'content-type', 'content-transfer-encoding']);

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const CHUNK = 0x8000;
	for (let start = 0; start < bytes.length; start += CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(start, start + CHUNK));
	}
	return btoa(binary);
}

/** Base64 in lines of 76, the MIME limit. */
function wrapBase64(base64: string): string {
	const lines: string[] = [];
	for (let start = 0; start < base64.length; start += 76) lines.push(base64.slice(start, start + 76));
	return lines.join(CRLF);
}

/** Header injection: a value never carries its own line breaks. */
function oneLine(value: string): string {
	return value.replaceAll(/[\r\n]+/g, ' ').trim();
}

function isPrintableAscii(value: string): boolean {
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code > 0x7e) return false;
	}
	return true;
}

/**
 * RFC 2047 encoded words, split on whole characters. 39 bytes of UTF-8 is 52
 * characters of base64, so a word is at most 64 long: under the 75 limit, and a
 * header such as `Subject: ` plus its first word stays within 78.
 */
export function encodeWords(value: string): string {
	const words: string[] = [];
	let chunk: number[] = [];
	for (const char of value) {
		const bytes = encoder.encode(char);
		if (chunk.length + bytes.length > 39) {
			words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
			chunk = [];
		}
		chunk.push(...bytes);
	}
	if (chunk.length > 0) words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
	return words.join(`${CRLF} `);
}

function headerText(value: string): string {
	const line = oneLine(value);
	return isPrintableAscii(line) ? line : encodeWords(line);
}

/** `Name <addr>`, with the name quoted or encoded as it needs. */
export function formatAddress(address: string, name?: string): string {
	const addr = oneLine(address).replaceAll(/[<>]/g, '');
	const display = name ? oneLine(name) : '';
	if (!display) return `<${addr}>`;
	if (!isPrintableAscii(display)) return `${encodeWords(display)} <${addr}>`;
	const quoted = display.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
	return `"${quoted}" <${addr}>`;
}

/** Folds a long ASCII header at spaces, keeping lines near the recommended 78. */
function fold(header: string): string {
	if (header.length <= 78) return header;
	const parts = header.split(' ');
	const lines: string[] = [];
	let line = '';
	for (const part of parts) {
		if (line && line.length + 1 + part.length > 78) {
			lines.push(line);
			line = part;
		} else {
			line = line ? `${line} ${part}` : part;
		}
	}
	lines.push(line);
	return lines.join(`${CRLF} `);
}

/** RFC 5322 date, in UTC. */
function formatDate(date: Date): string {
	return date.toUTCString().replace(/GMT$/, '+0000');
}

function randomBoundary(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `=_zimail_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Percent-encoding for RFC 2231, which also escapes the characters `encodeURIComponent` leaves. */
function percentEncode(value: string): string {
	return encodeURIComponent(value).replaceAll(/['()*!~]/g, (char) => `%${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`);
}

/** Splits percent-encoded text into pieces of about `size` without cutting a `%XX`. */
function percentChunks(encoded: string, size: number): string[] {
	const chunks: string[] = [];
	let start = 0;
	while (start < encoded.length) {
		let end = Math.min(start + size, encoded.length);
		const cut = encoded.lastIndexOf('%', end - 1);
		if (cut > end - 3 && cut >= start && end < encoded.length) end = cut;
		chunks.push(encoded.slice(start, end));
		start = end;
	}
	return chunks;
}

/**
 * A plain quoted name when it's short ASCII, otherwise RFC 2231 only (with
 * `*0*`, `*1*` continuations for a long one). An ASCII fallback beside it would
 * be what some parsers pick, losing the real name.
 */
function fileParams(kind: 'name' | 'filename', filename: string): string[] {
	const clean = oneLine(filename) || 'attachment';
	if (isPrintableAscii(clean) && !clean.includes('"') && clean.length <= 60) return [`${kind}="${clean}"`];
	const chunks = percentChunks(percentEncode(clean), 45);
	if (chunks.length === 1) return [`${kind}*=UTF-8''${chunks[0]}`];
	return chunks.map((chunk, index) => `${kind}*${index}*=${index === 0 ? "UTF-8''" : ''}${chunk}`);
}

/** `Type: value;` with each parameter folded onto its own line. */
function withParams(header: string, params: string[]): string {
	return [header, ...params].join(`;${CRLF} `);
}

type Part = { headers: string[]; body: string };

function textPart(type: 'text/plain' | 'text/html', content: string): Part {
	return {
		headers: [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64'],
		body: wrapBase64(bytesToBase64(encoder.encode(content.replaceAll(/\r?\n/g, CRLF))))
	};
}

function attachmentPart(file: OutboundAttachmentInput): Part {
	const inline = file.disposition !== 'attachment' && Boolean(file.contentId);
	const headers = [
		withParams(`Content-Type: ${oneLine(file.type) || 'application/octet-stream'}`, fileParams('name', file.filename)),
		'Content-Transfer-Encoding: base64',
		withParams(`Content-Disposition: ${inline ? 'inline' : 'attachment'}`, fileParams('filename', file.filename))
	];
	if (inline) headers.push(`Content-ID: <${oneLine(file.contentId ?? '').replaceAll(/[<>]/g, '')}>`);
	return { headers, body: wrapBase64(file.content.replaceAll(/\s+/g, '')) };
}

function multipart(subtype: 'alternative' | 'related' | 'mixed', parts: Part[], boundary: string): Part {
	const body = parts
		.map((part) => `--${boundary}${CRLF}${part.headers.join(CRLF)}${CRLF}${CRLF}${part.body}`)
		.join(CRLF);
	return {
		headers: [withParams(`Content-Type: multipart/${subtype}`, [`boundary="${boundary}"`])],
		body: `${body}${CRLF}--${boundary}--`
	};
}

function messageBody(input: MimeInput, boundary: () => string): Part {
	const text = textPart('text/plain', input.text);
	let body = input.html ? multipart('alternative', [text, textPart('text/html', input.html)], boundary()) : text;

	const files = input.attachments ?? [];
	const inline = files.filter((file) => file.disposition !== 'attachment' && file.contentId);
	const attached = files.filter((file) => !inline.includes(file));
	if (inline.length > 0) body = multipart('related', [body, ...inline.map(attachmentPart)], boundary());
	if (attached.length > 0) body = multipart('mixed', [body, ...attached.map(attachmentPart)], boundary());
	return body;
}

export function buildMime(input: MimeInput): string {
	const boundary = input.boundary ?? randomBoundary;
	const headers = [
		`From: ${formatAddress(input.from.address, input.from.name)}`,
		fold(`To: ${input.to.map((address) => formatAddress(address)).join(', ')}`)
	];
	if (input.cc?.length) headers.push(fold(`Cc: ${input.cc.map((address) => formatAddress(address)).join(', ')}`));
	if (input.replyTo) headers.push(`Reply-To: ${formatAddress(input.replyTo)}`);
	headers.push(
		`Subject: ${headerText(input.subject)}`,
		`Date: ${formatDate(input.date)}`,
		`Message-ID: <${oneLine(input.messageId).replaceAll(/[<>]/g, '')}>`,
		'MIME-Version: 1.0'
	);
	for (const [name, value] of Object.entries(input.headers ?? {})) {
		const key = oneLine(name).replaceAll(/[^\x21-\x39\x3b-\x7e]/g, '');
		if (!key || OWN_HEADERS.has(key.toLowerCase())) continue;
		headers.push(fold(`${key}: ${headerText(value)}`));
	}

	const body = messageBody(input, boundary);
	return `${[...headers, ...body.headers].join(CRLF)}${CRLF}${CRLF}${body.body}${CRLF}`;
}
