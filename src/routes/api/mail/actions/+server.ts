import { json, type RequestHandler } from '@sveltejs/kit';
import { authorizeMailAction, isMailAction, type MailAction } from '$lib/server/api-access';
import { getMailStoreService } from '$lib/server/mail-store';
import { getSpamService } from '$lib/server/spam';

/** Actions that operate on the whole mailbox rather than a selection. */
const WHOLE_MAILBOX: MailAction[] = ['read-all', 'empty-trash'];

type ActionBody = {
	action?: MailAction;
	ids?: string[];
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const mailStore = getMailStoreService(platform);

	const body = (await request.json()) as ActionBody;
	const action = body.action;

	if (!isMailAction(action)) {
		return json({ error: 'Unknown action' }, { status: 400 });
	}

	if (locals.authMethod === 'api_token') {
		const access = authorizeMailAction({
			action,
			authMethod: 'api_token',
			scopes: locals.apiScopes
		});
		if (!access.ok) {
			return json({ error: access.error }, { status: access.status });
		}
	}

	const selected = (body.ids ?? []).filter((id) => typeof id === 'string' && id.length > 0);
	if (selected.length === 0 && !WHOLE_MAILBOX.includes(action)) {
		return json({ error: 'No messages selected' }, { status: 400 });
	}

	// The list works in conversations, so an action on a row applies to every
	// message in it — trashing a thread takes its replies along.
	const ids = await mailStore.expandToThreads(locals.user.id, selected);

	let affected = 0;

	switch (action) {
		case 'read':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { isRead: true });
			break;
		case 'unread':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { isRead: false });
			break;
		case 'star':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { isStarred: true });
			break;
		case 'unstar':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { isStarred: false });
			break;
		case 'archive':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { archived: true });
			break;
		case 'unarchive':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { archived: false });
			break;
		case 'spam':
		case 'notspam':
			// Also blocks or unblocks the senders, so it goes through the spam service.
			affected = await getSpamService(platform).setSpam(locals.user.id, ids, action === 'spam');
			break;
		case 'trash':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { trashed: true });
			break;
		case 'restore':
			affected = await mailStore.setEmailFlags(locals.user.id, ids, { trashed: false });
			break;
		case 'delete':
			affected = await mailStore.deleteEmailsPermanently(locals.user.id, platform?.env.ATTACHMENTS, ids);
			break;
		case 'read-all':
			affected = await mailStore.markAllRead(locals.user.id, locals.activeDomainId);
			break;
		case 'empty-trash':
			affected = await mailStore.emptyTrash(locals.user.id, platform?.env.ATTACHMENTS);
			break;
		default: {
			const _never: never = action;
			return _never;
		}
	}

	const counts = await mailStore.getMailboxCounts(locals.user.id, locals.activeDomainId);

	return json({ ok: true, affected, counts });
};
