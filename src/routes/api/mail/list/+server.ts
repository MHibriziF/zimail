import { json, type RequestHandler } from '@sveltejs/kit';
import { loadMailbox } from '$lib/server/mail-store/mailbox';
import { getMailStoreService } from '$lib/server/mail-store';
import { getCategoriesService } from '$lib/server/categories';
import type { MailboxView } from '$lib/types';

const FOLDERS = new Set<MailboxView>(['inbox', 'archive', 'starred', 'drafts', 'sent', 'trash', 'all', 'spam']);

function parseFolder(value: string | null): MailboxView | null {
	return value && FOLDERS.has(value as MailboxView) ? (value as MailboxView) : null;
}

/** One mailbox list, as the mailbox pages render it, plus the cursor it was read at. */
export const GET: RequestHandler = async ({ locals, platform, url }) => {
	const db = platform?.env.DB;
	const user = locals.user;
	if (!db || !user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const folder = parseFolder(url.searchParams.get('folder'));
	if (!folder) {
		return json({ error: 'Unknown folder' }, { status: 400 });
	}

	// The cursor is read before the list: mail landing in between then leaves the
	// snapshot looking older than it is, which costs a refetch, never a stale list.
	const [cursor, tabs] = await Promise.all([
		getMailStoreService(platform).getMailboxCursor(user.id, locals.activeDomainId),
		folder === 'inbox' ? getCategoriesService(platform).tabsEnabled(user.id) : false
	]);
	const data = await loadMailbox(db, user.id, folder, url, locals.activeDomainId, { tabs });

	return json({ ...data, cursor }, { headers: { 'Cache-Control': 'private, no-store' } });
};
