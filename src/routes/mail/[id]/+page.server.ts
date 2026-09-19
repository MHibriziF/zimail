import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMailStoreService } from '$lib/server/mail-store';
import { resolveReplyFromAddress } from '$lib/server/outbound/outbox';
import { displaySubject } from '$lib/server/mail-store/threads';
import { getDomainsService } from '$lib/server/domains';
import { getLabelsService } from '$lib/server/labels';

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) {
		throw error(401, 'Unauthorized');
	}

	const mailStore = getMailStoreService(platform);
	const email = await mailStore.getEmailForUser(locals.user.id, params.id);
	if (!email) {
		throw error(404, 'Email not found');
	}

	// Opening any message opens its whole conversation.
	const newlyRead = await mailStore.markThreadRead(locals.user.id, email);
	const [messages, addresses] = await Promise.all([
		mailStore.listThreadMessages(locals.user.id, email),
		getDomainsService(platform).listAddressesForUser(locals.user.id)
	]);
	const identities = new Map(addresses.map((address) => [address.address.toLowerCase(), address]));

	const threadId = email.thread_id ?? email.id;
	const labels = await getLabelsService(platform).listForConversations(locals.user.id, [threadId]);

	const latest = messages[messages.length - 1] ?? email;
	const replyIdentity = await resolveReplyFromAddress(platform.env.DB, locals.user, latest);

	return {
		threadId,
		conversationLabels: labels.get(threadId) ?? [],
		/** The message that was linked to — expanded first when the page opens. */
		focusId: email.id,
		trashed: Boolean(email.deleted_at),
		archived: Boolean(email.archived_at),
		spam: Boolean(email.spam_at),
		/** Opening this thread cleared unread messages, so the badges are stale. */
		markedRead: newlyRead > 0,
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		replyFrom: replyIdentity?.address ?? null,
		replyFromName: replyIdentity?.label?.trim() || null,
		messages: messages.map((message) => {
			const received =
				message.direction === 'inbound'
					? identities.get(message.to_addr.trim().toLowerCase())
					: undefined;
			return {
				...message,
				is_read: true,
				received_label: received?.label?.trim() || null
			};
		})
	};
};
