import type { D1Database } from '@cloudflare/workers-types';
import type { DeliveryStatus } from '$lib/types';
import { MAX_BODY_BYTES } from '../constants';
import { collectInboundRecipients, parseEmailIdentity } from '../util/email-address';
import { updateEmailStatusByProviderId } from '../mail-store';
import type { ReceivedAttachment, ResendClient } from '../providers/resend-client';
import {
	storeInbound,
	type InboundAttachment,
	type InboundEnv,
	type InboundSource,
	type StoreOutcome
} from './pipeline';

export type ResendWebhookEvent = {
	type: string;
	created_at?: string;
	data?: Record<string, unknown>;
};

export type WebhookOutcome = {
	handled: boolean;
	note: string;
};

/** Resend delivery events → the status we display on a sent message. */
const STATUS_BY_EVENT: Record<string, DeliveryStatus> = {
	'email.sent': 'sent',
	'email.delivered': 'delivered',
	'email.delivery_delayed': 'delayed',
	'email.bounced': 'bounced',
	'email.complained': 'complained',
	'email.failed': 'failed'
};

export async function handleResendWebhook(
	event: ResendWebhookEvent,
	env: InboundEnv,
	client: ResendClient
): Promise<WebhookOutcome> {
	if (event.type === 'email.received') {
		return handleInboundEmail(event, env, client);
	}

	const status = STATUS_BY_EVENT[event.type];
	if (status) {
		return handleDeliveryStatus(event, env.DB, status);
	}

	return { handled: false, note: `Ignored event type ${event.type}` };
}

async function handleDeliveryStatus(
	event: ResendWebhookEvent,
	db: D1Database,
	status: DeliveryStatus
): Promise<WebhookOutcome> {
	const providerId = readString(event.data?.email_id);
	if (!providerId) {
		return { handled: false, note: 'Delivery event without email_id' };
	}

	const detail =
		readString((event.data?.bounce as Record<string, unknown> | undefined)?.message) ??
		readString((event.data?.bounce as Record<string, unknown> | undefined)?.subType) ??
		readString(event.data?.reason) ??
		null;

	const outcome = await updateEmailStatusByProviderId(db, providerId, status, detail);
	if (outcome === 'stale') {
		return { handled: true, note: `Ignored ${status} for ${providerId}: unknown, or already further along` };
	}
	return { handled: true, note: `Marked ${providerId} as ${status}` };
}

async function handleInboundEmail(
	event: ResendWebhookEvent,
	env: InboundEnv,
	client: ResendClient
): Promise<WebhookOutcome> {
	const source = fromResendEvent(client, event);
	if (!source) {
		return { handled: false, note: 'email.received without email_id' };
	}
	// Resend retries on non-2xx; the note says plainly when a retry changed nothing.
	return { handled: true, note: describe(await storeInbound(env, source), source.providerId) };
}

function describe(outcome: StoreOutcome, providerId: string): string {
	switch (outcome.kind) {
		case 'duplicate':
			return `Already stored ${providerId}`;
		case 'unrouted':
			return outcome.recorded ? `Stored ${providerId} as unrouted` : `Already unrouted ${providerId}`;
		case 'spam':
			return `Filed ${providerId} as spam for ${outcome.address}`;
		case 'stored':
			return `Delivered ${providerId} to ${outcome.address}${outcome.viaCatchall ? ' (catch-all)' : ''}`;
	}
}

/**
 * An `email.received` event as an inbound source. The webhook carries metadata
 * only; the body and attachments come from the API when the pipeline asks.
 */
export function fromResendEvent(client: ResendClient, event: ResendWebhookEvent): InboundSource | null {
	const providerId = readString(event.data?.email_id);
	if (!providerId) return null;

	return {
		providerId,
		async read() {
			let received = await client.getReceivedEmail(providerId, 'data_uri');

			// Inline images inflate data-URI HTML past what we store; fall back to `cid`
			// so the body stays intact and the images remain as attachments.
			if ((received.html?.length ?? 0) > MAX_BODY_BYTES) {
				received = await client.getReceivedEmail(providerId, 'cid');
			}

			// The same address `parseEmailAddress` would return, plus the display name.
			const sender = parseEmailIdentity(received.from ?? '');
			// Resend hands headers over as a plain object; don't rely on its key casing.
			const headers = new Map(
				Object.entries(received.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
			);

			return {
				envelopeTo: null,
				recipients: collectInboundRecipients({
					received_for: (event.data?.received_for as string[] | undefined) ?? received.received_for,
					to: received.to,
					cc: received.cc,
					bcc: received.bcc
				}),
				from: sender.address,
				fromName: sender.name,
				cc: received.cc ?? [],
				subject: received.subject,
				text: received.text,
				html: received.html,
				messageId: received.message_id ?? null,
				inReplyTo: headers.get('in-reply-to') ?? null,
				references: headers.get('references') ?? null,
				header: (name) => headers.get(name),
				async attachments() {
					const listed = await listInboundAttachments(client, providerId);
					return listed.map((attachment) => resendAttachment(client, attachment));
				}
			};
		}
	};
}

function resendAttachment(client: ResendClient, attachment: ReceivedAttachment): InboundAttachment {
	const url = attachment.download_url;
	return {
		filename: attachment.filename,
		contentType: attachment.content_type,
		disposition: attachment.content_disposition,
		contentId: attachment.content_id,
		size: attachment.size,
		// Signed URLs are how Resend hands the bytes over; a part without one was never delivered.
		content: url ? () => client.downloadAttachment(url) : null
	};
}

async function listInboundAttachments(client: ResendClient, providerId: string): Promise<ReceivedAttachment[]> {
	try {
		return await client.listReceivedAttachments(providerId);
	} catch (error) {
		console.error('Failed to list inbound attachments', providerId, error);
		return [];
	}
}

/** Resend retries on non-2xx, so record ids we've already processed. */
export async function claimWebhookEvent(
	db: D1Database,
	eventId: string,
	type: string
): Promise<boolean> {
	const result = await db
		.prepare('INSERT OR IGNORE INTO webhook_events (id, type) VALUES (?, ?)')
		.bind(eventId, type)
		.run();

	return (result.meta?.changes ?? 0) > 0;
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
