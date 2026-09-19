import { json, type RequestHandler } from '@sveltejs/kit';
import { parseScheduledAt } from '$lib/server/util/schedule';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import { getMailStoreService } from '$lib/server/mail-store';
import { getLabelsService } from '$lib/server/labels';
import { getSpamService } from '$lib/server/spam';
import { getCategoriesService } from '$lib/server/categories';
import { parseMailCategory } from '$lib/mail/categories';
import { resolveReplyFromAddress, sendAndStore } from '$lib/server/outbound/outbox';
import { buildReferences, displaySubject } from '$lib/server/mail-store/threads';
import type { OutboundAttachmentInput } from '$lib/types';

type ReplyBody = {
	scheduledAt?: string;
	fromAddressId?: string;
	text?: string;
	html?: string;
	attachments?: OutboundAttachmentInput[];
};

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const mailStore = getMailStoreService(platform);
	const email = await mailStore.getEmailForUser(locals.user.id, params.id!);
	if (!email) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	await mailStore.markThreadRead(locals.user.id, email);
	const messages = await mailStore.listThreadMessages(locals.user.id, email);
	const threadId = email.thread_id ?? email.id;
	const labels = await getLabelsService(platform).listForConversations(locals.user.id, [threadId]);

	return json({
		threadId,
		category: email.category ?? 'primary',
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		labels: labels.get(threadId) ?? [],
		messages
	});
};

/** Flag toggles from the list and the reader — applied to the whole thread. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const mailStore = getMailStoreService(platform);
	const body = (await request.json()) as {
		isRead?: boolean;
		isStarred?: boolean;
		archived?: boolean;
		trashed?: boolean;
		/** Report as spam (true) or move back out of Spam (false) — always the whole conversation. */
		spam?: boolean;
		/** Move the conversation to another inbox tab, remembering its sender. */
		category?: string;
		/** Set to limit the change to this one message instead of the thread. */
		messageOnly?: boolean;
	};

	const category = parseMailCategory(body.category);
	if (category) {
		const changed = await getCategoriesService(platform).moveToCategory(locals.user.id, [params.id!], category);
		return changed > 0 ? json({ ok: true }) : json({ error: 'Not found' }, { status: 404 });
	}

	if (typeof body.spam === 'boolean') {
		const changed = await getSpamService(platform).setSpam(locals.user.id, [params.id!], body.spam);
		return changed > 0 ? json({ ok: true }) : json({ error: 'Not found' }, { status: 404 });
	}

	// Archiving is always a conversation action — a half-archived thread would
	// show up in both the inbox and the archive.
	const ids =
		body.messageOnly && body.archived === undefined
			? [params.id!]
			: await mailStore.expandToThreads(locals.user.id, [params.id!]);

	const changed = await mailStore.setEmailFlags(locals.user.id, ids, {
		isRead: body.isRead,
		isStarred: body.isStarred,
		archived: body.archived,
		trashed: body.trashed
	});

	if (changed === 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const mailStore = getMailStoreService(platform);
	const ids = await mailStore.expandToThreads(locals.user.id, [params.id!]);
	const removed = await mailStore.deleteEmailsPermanently(locals.user.id, platform?.env.ATTACHMENTS, ids);

	if (removed === 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const original = await getMailStoreService(platform).getEmailForUser(locals.user.id, params.id!);
	if (!original) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = (await request.json()) as ReplyBody;
	if (!body.text?.trim() && !body.html?.trim()) {
		return json({ error: 'Message body is required' }, { status: 400 });
	}

	const schedule = parseScheduledAt(body.scheduledAt);
	if (schedule.error) return json({ error: schedule.error }, { status: 400 });

	const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
	// Replying to our own message continues the conversation with its recipient.
	const to = original.direction === 'inbound' ? original.from_addr : original.to_addr;

	// Reply from the mailbox that received the original. Catch-all mail uses
	// that exact recipient when the user can send on the domain.
	const fromAddress = body.fromAddressId
		? undefined
		: await resolveReplyFromAddress(db, locals.user, original);

	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendAndStore(
			{ DB: db, ATTACHMENTS: bucket },
			provider,
			locals.user,
			{
				fromAddressId: body.fromAddressId,
				fromAddress,
				to,
				subject,
				text: body.text,
				html: body.html,
				inReplyTo: original.message_id,
				// Carry the chain forward so the recipient's client — and ours,
				// when they answer — keeps the conversation together.
				references: buildReferences(original.references_header, original.message_id),
				replyToEmailId: original.id,
				attachments: body.attachments,
				scheduledAt: schedule.iso
			}
		);

		return json({ ok: true, id: emailId });
	} catch (error) {
		return json(
			{ error: describeProviderError(error, 'Failed to send reply') },
			{ status: statusForProviderError(error) }
		);
	}
};
