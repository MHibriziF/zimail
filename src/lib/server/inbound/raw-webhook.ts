import type { CloudflareInboundMessage } from './cloudflare-inbound';

/**
 * Inbound mail as raw MIME over HTTP, for anything that isn't Resend or
 * Cloudflare Email Routing:
 * - a body that *is* the message (`message/rfc822`), e.g. from a Postfix or
 *   OpenSMTPD pipe: `curl --data-binary @- -H "X-Envelope-To: $recipient" …`
 * - SendGrid Inbound Parse with "POST the raw, full MIME message" (`email` and
 *   `envelope` form fields)
 * - a Mailgun route forwarding to a URL ending in `mime` (`body-mime`,
 *   `recipient` and `sender` fields)
 *
 * Whoever holds the secret can put mail in any inbox here, so it's required
 * (Bearer, or Basic with the secret as the password, which suits forwarders
 * that only take a URL) and compared in constant time. It's never accepted in
 * the query string, where it would end up in logs.
 */

/** Big enough for a message at the attachment limit after base64; anything larger is refused unread. */
export const MAX_RAW_MESSAGE_BYTES = 40 * 1024 * 1024;

export type RawInboundOutcome =
	| { kind: 'message'; message: CloudflareInboundMessage }
	| { kind: 'unauthorized' }
	| { kind: 'too_large' }
	| { kind: 'invalid'; reason: string };

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/** Compares hashes, so neither the length nor the content of the secret leaks through timing. */
export async function secretMatches(given: string, secret: string): Promise<boolean> {
	const [a, b] = await Promise.all([digest(given), digest(secret)]);
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
	return difference === 0;
}

function presentedSecret(headers: Headers): string | null {
	const authorization = headers.get('authorization')?.trim() ?? '';
	const [scheme, value = ''] = authorization.split(/\s+/, 2);
	if (scheme?.toLowerCase() === 'bearer') return value;
	if (scheme?.toLowerCase() === 'basic') {
		try {
			const decoded = atob(value);
			return decoded.slice(decoded.indexOf(':') + 1);
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * `Headers` only takes byte-range characters, and raw UTF-8 in a header (which
 * some mailers send) would make it drop the whole field. A `?` keeps the rest.
 */
function byteString(value: string): string {
	return Array.from(value, (char) => ((char.codePointAt(0) ?? 0) > 0xff ? '?' : char)).join('');
}

/** A header block's fields, unfolded, as `Headers`, for the bits the pipeline reads straight off them. */
export function parseHeaderBlock(raw: Uint8Array): Headers {
	const head = new TextDecoder().decode(raw.subarray(0, Math.min(raw.length, 256 * 1024)));
	const end = head.search(/\r?\n\r?\n/);
	const block = end >= 0 ? head.slice(0, end) : head;
	const headers = new Headers();
	for (const field of block.split(/\r?\n(?![ \t])/)) {
		const colon = field.indexOf(':');
		if (colon <= 0) continue;
		const name = field.slice(0, colon).trim();
		const value = byteString(field.slice(colon + 1).replaceAll(/\r?\n[ \t]+/g, ' ').trim());
		try {
			headers.append(name, value);
		} catch {
			// A field name Headers won't take is not one the pipeline reads.
		}
	}
	return headers;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		}
	});
}

type Envelope = { from: string; to: string };

function formText(form: FormData, name: string): string {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
}

/** SendGrid sends `envelope` as JSON, Mailgun as separate `sender`/`recipient` fields. */
function formEnvelope(form: FormData): Envelope {
	const envelope = formText(form, 'envelope');
	if (envelope) {
		try {
			const parsed = JSON.parse(envelope) as { from?: unknown; to?: unknown };
			// The pipeline takes one envelope recipient; the others still route through To and Cc.
			const to = Array.isArray(parsed.to) ? (parsed.to.find((item) => typeof item === 'string') ?? '') : '';
			return { from: typeof parsed.from === 'string' ? parsed.from : '', to };
		} catch {
			// Fall through to the To/Cc headers.
		}
	}
	return { from: formText(form, 'sender'), to: formText(form, 'recipient') };
}

async function formMessage(form: FormData): Promise<{ raw: Uint8Array; envelope: Envelope } | null> {
	const field = form.get('email') ?? form.get('body-mime');
	if (field === null) return null;
	const raw = typeof field === 'string' ? encoder.encode(field) : new Uint8Array(await field.arrayBuffer());
	return { raw, envelope: formEnvelope(form) };
}

function isMime(raw: Uint8Array): boolean {
	const headers = parseHeaderBlock(raw);
	return headers.has('from') || headers.has('received') || headers.has('message-id');
}

export async function readRawInbound(request: Request, secret: string): Promise<RawInboundOutcome> {
	const given = presentedSecret(request.headers);
	if (given === null || !(await secretMatches(given, secret))) return { kind: 'unauthorized' };

	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > MAX_RAW_MESSAGE_BYTES) return { kind: 'too_large' };

	const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
	let raw: Uint8Array;
	let envelope: Envelope = {
		from: request.headers.get('x-envelope-from') ?? '',
		to: request.headers.get('x-envelope-to') ?? ''
	};

	if (contentType.startsWith('multipart/form-data') || contentType.startsWith('application/x-www-form-urlencoded')) {
		const parsed = await formMessage(await request.formData());
		if (!parsed) return { kind: 'invalid', reason: 'No `email` or `body-mime` field with the raw message' };
		raw = parsed.raw;
		envelope = { from: envelope.from || parsed.envelope.from, to: envelope.to || parsed.envelope.to };
	} else {
		raw = new Uint8Array(await request.arrayBuffer());
	}

	if (raw.byteLength > MAX_RAW_MESSAGE_BYTES) return { kind: 'too_large' };
	if (raw.byteLength === 0 || !isMime(raw)) return { kind: 'invalid', reason: 'The body is not a MIME message' };

	return {
		kind: 'message',
		message: {
			from: envelope.from,
			to: envelope.to,
			headers: parseHeaderBlock(raw),
			raw: streamOf(raw),
			setReject() {}
		}
	};
}
