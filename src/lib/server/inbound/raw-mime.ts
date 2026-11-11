import PostalMime, { type Address, type Attachment } from 'postal-mime';
import { collectInboundRecipients, parseEmailAddress } from '../util/email-address';
import { normalizeMessageId } from '../outbound/send-mail';
import {
	storeInbound,
	type InboundAttachment,
	type InboundEnv,
	type InboundSource,
	type StoreOutcome
} from './pipeline';

/**
 * A message as raw MIME: what Cloudflare Email Routing delivers to the Worker's
 * `email()` handler, and what the raw-MIME webhook rebuilds from a POST.
 */
export type RawInboundMessage = {
	/** The envelope sender (SMTP `MAIL FROM`). */
	readonly from: string;
	/** The envelope recipient (SMTP `RCPT TO`). */
	readonly to: string;
	readonly headers: Headers;
	readonly raw: ReadableStream<Uint8Array>;
	setReject(reason: string): void;
};

export type RawEnvelope = Pick<RawInboundMessage, 'from' | 'to' | 'headers'>;

/** Parse once, then store through the same pipeline as every other source. */
export async function handleRawInbound(message: RawInboundMessage, env: InboundEnv): Promise<StoreOutcome> {
	const raw = await new Response(message.raw).arrayBuffer();
	return storeInbound(env, await fromRawMime(raw, message));
}

/**
 * Raw MIME as an inbound source. The whole message has to be parsed before its
 * id is known, so the message is ready by the time the pipeline asks for it.
 */
export async function fromRawMime(raw: ArrayBuffer, envelope: RawEnvelope): Promise<InboundSource> {
	const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
	const headers = envelope.headers;

	const envelopeTo = parseEmailAddress(envelope.to);
	const recipients = collectInboundRecipients({
		received_for: envelopeTo.includes('@') ? [envelopeTo] : [],
		to: mailboxAddresses(parsed.to),
		cc: mailboxAddresses(parsed.cc),
		bcc: mailboxAddresses(parsed.bcc)
	});

	const sender = firstMailboxIdentity(parsed.from);
	const from = inboundSender(sender?.address, envelope.from);
	const messageId = normalizeMessageId(parsed.messageId ?? headers.get('message-id')) ?? null;
	const inReplyTo = normalizeMessageId(parsed.inReplyTo ?? headers.get('in-reply-to')) ?? null;
	const references = parsed.references ?? headers.get('references') ?? null;
	const providerId = await inboundProviderId({
		messageId,
		from,
		to: envelopeTo || recipients.join(','),
		date: parsed.date ?? headers.get('date')
	});

	const attachments = parsed.attachments.map(rawAttachment);

	return {
		providerId,
		async read() {
			return {
				envelopeTo: envelopeTo || null,
				recipients,
				from,
				fromName: sender?.name ?? null,
				cc: mailboxAddresses(parsed.cc),
				subject: parsed.subject?.trim() || headers.get('subject'),
				text: parsed.text ?? null,
				html: parsed.html ?? null,
				messageId,
				inReplyTo,
				references,
				header: (name) => headers.get(name),
				attachments: async () => attachments
			};
		}
	};
}

function rawAttachment(attachment: Attachment): InboundAttachment {
	const bytes = attachmentBytes(attachment.content);
	return {
		filename: attachment.filename ?? '',
		contentType: attachment.mimeType,
		disposition: attachment.disposition,
		contentId: attachment.contentId,
		related: attachment.related,
		// An empty part is nothing the reader could open, so it is treated as never delivered.
		content: bytes && bytes.byteLength > 0 ? bytes : null
	};
}

/**
 * Who the mail is *from*, for display, replies and search.
 *
 * `message.from` is the envelope sender — SMTP `MAIL FROM` — which providers
 * routinely point at a bounce mailbox rather than the author. Cloudflare Email
 * Sending uses `bounces@cf-bounce.<domain>`, and VERP senders behave the same
 * way, so preferring the envelope attributes mail to the bounce address and
 * sends replies there. The `From:` header carries the author, so it wins; the
 * envelope is only a fallback for mail that arrives without a usable header.
 */
export function inboundSender(
	headerFrom: string | undefined,
	envelopeFrom: string | undefined
): string {
	// Choose on whether the header actually yielded an address, not on whether it
	// was present: a blank or malformed `From:` is still a truthy string, and
	// picking it on that alone would skip the fallback entirely.
	const header = parseEmailAddress(headerFrom ?? '');
	if (header.includes('@')) return header;

	const envelope = parseEmailAddress(envelopeFrom ?? '');
	return envelope || header;
}

/**
 * The sender, as both halves — postal-mime already parsed the display name out
 * of the `From:` header, so there is no need to parse it again.
 */
function firstMailboxIdentity(
	value: Address | Address[] | undefined
): { name: string | null; address: string } | null {
	if (!value) return null;
	const list = Array.isArray(value) ? value : [value];

	for (const item of list) {
		if (item.address) {
			return { name: item.name?.trim() || null, address: parseEmailAddress(item.address) };
		}
		if (item.group) {
			for (const member of item.group) {
				if (member.address) {
					return {
						name: member.name?.trim() || null,
						address: parseEmailAddress(member.address)
					};
				}
			}
		}
	}

	return null;
}

function mailboxAddresses(value: Address | Address[] | undefined): string[] {
	if (!value) return [];
	const list = Array.isArray(value) ? value : [value];
	const addresses: string[] = [];

	for (const item of list) {
		if (item.address) addresses.push(item.address);
		if (item.group) {
			for (const member of item.group) {
				if (member.address) addresses.push(member.address);
			}
		}
	}

	return addresses;
}

function attachmentBytes(content: Attachment['content']): Uint8Array | null {
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	if (ArrayBuffer.isView(content)) {
		return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	}
	if (typeof content === 'string' && content.length > 0) {
		return new TextEncoder().encode(content);
	}
	return null;
}

/**
 * Raw MIME has no provider id, so the Message-ID stands in; without one, a hash
 * of who sent what to whom and when. The `cf-` prefix predates the generic raw
 * path and stays, so mail already stored is still recognised on a retry.
 */
async function inboundProviderId(input: {
	messageId: string | null;
	from: string;
	to: string;
	date: string | null | undefined;
}): Promise<string> {
	if (input.messageId) return input.messageId;

	const material = `${input.from}\n${input.to}\n${input.date ?? ''}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
	const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	return `cf-${hex.slice(0, 32)}`;
}
