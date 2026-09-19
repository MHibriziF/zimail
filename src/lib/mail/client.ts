import type { OutboundAttachmentInput } from '$lib/types';
import type { Label, LabelColor } from '$lib/mail/labels';

/**
 * Every write a shell makes to the mailbox, in one place.
 *
 * Both shells render their own composer and thread pane, so before this
 * existed each built its own request body by hand — which is exactly how
 * scheduled send ended up working in Classic and silently missing from Zero.
 * A field added here reaches both.
 */

/**
 * The server answered, and said no.
 *
 * Distinguished from a network failure so a shell can show what the server
 * actually said rather than a generic "network error" for a rejected send.
 */
export class MailRequestError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'MailRequestError';
		this.status = status;
	}
}

/** The message to show a person: the server's own words, else `fallback`. */
export function describeMailError(error: unknown, fallback: string): string {
	return error instanceof MailRequestError ? error.message : fallback;
}

async function post<T = unknown>(url: string, body: unknown, fallback: string): Promise<T> {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

	const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
	if (!response.ok) {
		throw new MailRequestError(response.status, payload.error ?? fallback);
	}

	return payload;
}

export async function runMailAction(
	action: string,
	ids: string[] = []
): Promise<{ ok: boolean; affected?: number }> {
	const body = await post<{ affected?: number }>(
		'/api/mail/actions',
		{ action, ids },
		'Could not update mail'
	);
	return { ok: true, affected: body.affected };
}

/** Flags are booleans; `category` moves the conversation to another inbox tab. */
export async function patchThread(id: string, flags: Record<string, boolean | string>): Promise<void> {
	const response = await fetch(`/api/mail/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(flags)
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };
		throw new MailRequestError(
			response.status,
			body.error ?? 'Could not update this conversation'
		);
	}
}

/** Permanently removes a message. Only reachable from the trash. */
export async function deleteMessage(messageId: string): Promise<void> {
	const response = await fetch(`/api/mail/${encodeURIComponent(messageId)}`, {
		method: 'DELETE'
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };
		throw new MailRequestError(response.status, body.error ?? 'Could not delete that message');
	}
}

export type SendMessageInput = {
	/** Set when the composer was editing a draft — it is removed once sent. */
	draftId?: string | null;
	fromAddressId?: string;
	to: string;
	cc?: string;
	bcc?: string;
	subject: string;
	html: string;
	text: string;
	attachments?: OutboundAttachmentInput[];
	/** ISO 8601. Stored unsent and delivered by the cron sweep. */
	scheduledAt?: string | null;
};

export async function sendMessage(input: SendMessageInput): Promise<{ id?: string }> {
	return post<{ id?: string }>(
		'/api/mail',
		{
			draftId: input.draftId ?? undefined,
			fromAddressId: input.fromAddressId,
			to: input.to,
			cc: input.cc?.trim() || undefined,
			bcc: input.bcc?.trim() || undefined,
			subject: input.subject,
			html: input.html,
			text: input.text,
			attachments: input.attachments,
			scheduledAt: input.scheduledAt ?? undefined
		},
		'Failed to send'
	);
}

export type SendReplyInput = {
	/** Only the shells that expose the fields send these. */
	to?: string;
	cc?: string;
	bcc?: string;
	html: string;
	text: string;
	attachments?: OutboundAttachmentInput[];
	scheduledAt?: string | null;
};

/** Replies continue from `messageId`, so the conversation chain stays intact. */
export async function sendReply(messageId: string, input: SendReplyInput): Promise<void> {
	await post(
		`/api/mail/${encodeURIComponent(messageId)}`,
		{
			to: input.to?.trim() || undefined,
			cc: input.cc?.trim() || undefined,
			bcc: input.bcc?.trim() || undefined,
			html: input.html,
			text: input.text,
			attachments: input.attachments,
			scheduledAt: input.scheduledAt ?? undefined
		},
		'Failed to send'
	);
}

export type ForwardInput = {
	to: string;
	cc?: string;
	bcc?: string;
	html?: string;
	text?: string;
	includeAttachments?: boolean;
	/** Set to forward the whole conversation instead of the one message. */
	threadId?: string | null;
};

export async function forwardMessage(messageId: string, input: ForwardInput): Promise<void> {
	const url = input.threadId
		? `/api/mail/thread/${encodeURIComponent(input.threadId)}/forward`
		: `/api/mail/${encodeURIComponent(messageId)}/forward`;

	await post(
		url,
		{
			to: input.to,
			cc: input.cc?.trim() || undefined,
			bcc: input.bcc?.trim() || undefined,
			html: input.html,
			text: input.text,
			includeAttachments: input.includeAttachments
		},
		'Failed to forward'
	);
}

/**
 * Takes a waiting message back out of the outbox.
 *
 * Returns the id it became, so the caller can reopen it as a draft — the
 * writing is not thrown away with the schedule.
 */
export async function cancelScheduledSend(messageId: string): Promise<string | undefined> {
	const body = await post<{ draftId?: string }>(
		`/api/mail/${encodeURIComponent(messageId)}/cancel-schedule`,
		{},
		'Could not recall that message'
	);
	return body.draftId;
}

/** Replaces the labels on the conversation `emailId` belongs to; resolves to what's applied now. */
export async function setConversationLabels(emailId: string, labelIds: string[]): Promise<Label[]> {
	const response = await fetch(`/api/mail/${encodeURIComponent(emailId)}/labels`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ labelIds })
	});
	const body = (await response.json().catch(() => ({}))) as { labels?: Label[]; error?: string };
	if (!response.ok || !body.labels) {
		throw new MailRequestError(response.status, body.error ?? 'Could not update the labels');
	}
	return body.labels;
}

async function labelRequest(url: string, method: string, payload?: unknown): Promise<Label | null> {
	const response = await fetch(url, {
		method,
		headers: payload ? { 'Content-Type': 'application/json' } : undefined,
		body: payload ? JSON.stringify(payload) : undefined
	});
	const body = (await response.json().catch(() => ({}))) as { label?: Label; error?: string };
	if (!response.ok) throw new MailRequestError(response.status, body.error ?? 'Could not save the label');
	return body.label ?? null;
}

export async function createLabel(input: { name: string; color: LabelColor }): Promise<Label> {
	return (await labelRequest('/api/labels', 'POST', input)) as Label;
}

export async function updateLabel(id: string, changes: { name?: string; color?: LabelColor }): Promise<Label> {
	return (await labelRequest(`/api/labels/${encodeURIComponent(id)}`, 'PATCH', changes)) as Label;
}

export async function deleteLabel(id: string): Promise<void> {
	await labelRequest(`/api/labels/${encodeURIComponent(id)}`, 'DELETE');
}
