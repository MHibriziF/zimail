import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { inboundAttachmentMetadata, insertAttachmentBytes } from '../attachments';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from '../constants';
import { recordUnroutedEmail, resolveInboundRoute, type InboundRoute } from '../domains';
import { emailExistsByProviderId, insertEmail } from '../mail-store';
import { scheduleNewMailNotification, type PushNotificationEnv } from '../push-notifications';
import {
	scheduleTelegramNotification,
	type StoredAttachment,
	type TelegramNotificationEnv
} from '../telegram-notify';
import { plainBody } from '../util/html';
import { isCalendarAttachment } from '../../utils/attachments';
import { applyArrivedInvitation, hasBytes } from '../invitations';
import { isFiledAsSpam, spamServiceForDb } from '../spam';
import type { AiBinding } from '../ai/service';
import { categoriesServiceForDb, pickClassifyHeaders } from '../categories';

/**
 * The one place inbound mail is stored. Every source (the Resend webhook,
 * Cloudflare Email Routing, the raw-MIME webhook) only parses what it received
 * into an `InboundSource` and hands it here, so routing, spam, tabs, storage
 * and notifications are decided once and the same way for all of them.
 */

export type InboundEnv = PushNotificationEnv &
	TelegramNotificationEnv & {
		ATTACHMENTS: R2Bucket;
		/** Sorts inbox tabs with Clef when the user turned that on. */
		AI?: AiBinding;
	};

/** One part of an inbound message, however the source delivers it. */
export type InboundAttachment = {
	filename: string;
	contentType: string;
	disposition?: string | null;
	contentId?: string | null;
	/** Referenced from a multipart/related body, so the sender's client showed it inline. */
	related?: boolean;
	/** What the source's listing claims; the body is the truth. */
	size?: number;
	/**
	 * The bytes, or how to fetch them. `null` when the source listed the part
	 * but never delivered it, so the reader is not promised a file the mailbox
	 * does not have.
	 */
	content: Uint8Array | (() => Promise<Uint8Array>) | null;
};

/** An inbound message with its source's quirks already resolved. */
export type InboundMessage = {
	/** The envelope recipient, when the source gives one; shown only when nothing else names a recipient. */
	envelopeTo: string | null;
	/** Every address the message was delivered to or addressed to, envelope first, deduplicated. */
	recipients: string[];
	/** The author's address, lower-cased, never the bounce envelope. */
	from: string;
	fromName: string | null;
	cc: string[];
	/** As the source gave it; blank becomes `(no subject)` here. */
	subject: string | null | undefined;
	text: string | null;
	html: string | null;
	messageId: string | null;
	inReplyTo: string | null;
	/** The whole chain, so a reply still joins a conversation whose direct parent we never saw. */
	references: string | null;
	/** A header by lower-case name, the way the source exposes headers. */
	header: (name: string) => string | null | undefined;
	/** Listed only once a mailbox is found, because a listing can cost an API call. */
	attachments: () => Promise<InboundAttachment[]>;
};

/**
 * A source names its id up front, so a repeat delivery is recognised before
 * the message itself is fetched or parsed any further.
 */
export type InboundSource = {
	providerId: string;
	read: () => Promise<InboundMessage>;
};

export type StoreOutcome =
	| { kind: 'duplicate' }
	| { kind: 'unrouted'; recorded: boolean }
	| { kind: 'spam'; address: string }
	| { kind: 'stored'; emailId: string; address: string; viaCatchall: boolean };

export async function storeInbound(env: InboundEnv, source: InboundSource): Promise<StoreOutcome> {
	const { providerId } = source;
	if (await emailExistsByProviderId(env.DB, providerId)) {
		return { kind: 'duplicate' };
	}

	const message = await source.read();
	const subject = message.subject?.trim() || '(no subject)';
	const route = await resolveInboundRoute(env.DB, message.recipients);
	if (!route) {
		return { kind: 'unrouted', recorded: await recordUnrouted(env, providerId, message, subject) };
	}

	const spam = await spamServiceForDb(env.DB).isSpamInbound(route.userId, message.from, [
		message.header('authentication-results'),
		message.header('arc-authentication-results')
	]);

	const attachments = await message.attachments();
	const body = plainBody(message.text, message.html);
	const category = await categoriesServiceForDb(env.DB, env.AI).categorizeInbound(route.userId, {
		from: message.from,
		fromName: message.fromName,
		subject,
		body,
		headers: pickClassifyHeaders(message.header),
		calendar: attachments.some((attachment) => isCalendarAttachment(attachment.contentType, attachment.filename)),
		reply: Boolean(message.inReplyTo || message.references),
		spam
	});

	const emailId = await insertEmail(env.DB, {
		userId: route.userId,
		direction: 'inbound',
		from: message.from,
		fromName: message.fromName,
		to: route.address,
		cc: message.cc.join(', ') || null,
		subject,
		bodyText: message.text,
		bodyHtml: message.html,
		messageId: message.messageId,
		inReplyTo: message.inReplyTo,
		references: message.references,
		domainId: route.domainId,
		addressId: route.addressId,
		providerId,
		spam,
		category
	});

	const stored = await storeInboundAttachments(env, emailId, attachments);
	// Mail filed in Spam is kept but never announced.
	if (await isFiledAsSpam(env.DB, route.userId, emailId)) {
		return { kind: 'spam', address: route.address };
	}
	await announce(env, route, emailId, message, subject, body, stored);
	return { kind: 'stored', emailId, address: route.address, viaCatchall: route.viaCatchall };
}

async function recordUnrouted(
	env: InboundEnv,
	providerId: string,
	message: InboundMessage,
	subject: string
): Promise<boolean> {
	const to = message.recipients.join(', ') || message.envelopeTo || '(unknown)';
	const recorded = await recordUnroutedEmail(env.DB, {
		providerId,
		from: message.from,
		to,
		subject,
		reason: 'No matching address and no catch-all for this domain'
	});
	if (recorded) {
		scheduleTelegramNotification(env, {
			from: message.from,
			to,
			subject,
			body: plainBody(message.text, message.html),
			unrouted: true
		});
	}
	return recorded;
}

async function announce(
	env: InboundEnv,
	route: InboundRoute,
	emailId: string,
	message: InboundMessage,
	subject: string,
	body: string | null,
	stored: StoredAttachment[]
): Promise<void> {
	await applyArrivedInvitation(env.DB, route.userId, stored.filter(hasBytes));
	await scheduleNewMailNotification(env, {
		emailId,
		userId: route.userId,
		from: message.from,
		subject
	});
	scheduleTelegramNotification(env, {
		from: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
		to: route.address,
		subject,
		body,
		attachments: stored,
		emailId
	});
}

async function attachmentBytes(attachment: InboundAttachment): Promise<Uint8Array | null> {
	if (attachment.content === null) return null;
	if (typeof attachment.content === 'function') return attachment.content();
	return attachment.content;
}

/** Returns the attachments that actually made it into storage. */
export async function storeInboundAttachments(
	env: Pick<InboundEnv, 'DB' | 'ATTACHMENTS'>,
	emailId: string,
	attachments: InboundAttachment[]
): Promise<StoredAttachment[]> {
	const stored: StoredAttachment[] = [];

	for (const attachment of attachments.slice(0, MAX_ATTACHMENTS_PER_EMAIL)) {
		if (attachment.content === null) continue;
		const filename = attachment.filename || 'attachment';
		if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) {
			console.warn(`Skipping oversized attachment ${filename} on ${emailId}`);
			continue;
		}

		try {
			const bytes = await attachmentBytes(attachment);
			if (!bytes || bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;

			const contentType = attachment.contentType || 'application/octet-stream';
			await insertAttachmentBytes(env.DB, env.ATTACHMENTS, emailId, {
				filename,
				type: contentType,
				bytes,
				...inboundAttachmentMetadata({
					disposition: attachment.disposition,
					contentId: attachment.contentId,
					related: attachment.related
				})
			});
			stored.push({ filename, sizeBytes: bytes.byteLength, contentType, bytes });
		} catch (error) {
			// One bad attachment shouldn't cost us the message.
			console.error('Failed to store inbound attachment', filename, error);
		}
	}

	return stored;
}
