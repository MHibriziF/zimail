import { listMailbox, mailStoreServiceForDb } from './index';
import { parseMailCategory, type MailCategory } from '$lib/mail/categories';
import type { MailboxFilters, MailboxPage, MailboxView } from '$lib/types';
import type { D1Database } from '@cloudflare/workers-types';

export function readFilters(url: URL): MailboxFilters {
	return {
		q: url.searchParams.get('q')?.trim() ?? '',
		unreadOnly: url.searchParams.get('unread') === '1',
		starredOnly: url.searchParams.get('starred') === '1',
		attachmentsOnly: url.searchParams.get('attachments') === '1',
		addressId: url.searchParams.get('address')?.trim() ?? '',
		labelId: url.searchParams.get('label')?.trim() ?? '',
		tab: ''
	};
}

const EMPTY: MailboxPage = { threads: [], total: 0, page: 1, pageCount: 1, pageSize: 25 };

/** Shared by every mailbox route — same query shape, different view. */
export async function loadMailbox(
	db: D1Database | undefined,
	userId: string | undefined,
	view: MailboxView,
	url: URL,
	domainId: string | null,
	options: { tabs?: boolean } = {}
): Promise<{
	view: MailboxView;
	mailbox: MailboxPage;
	filters: MailboxFilters;
	/** Unread conversations per tab, when the inbox is showing tabs. */
	tabCounts: Record<MailCategory, number> | null;
}> {
	const filters = readFilters(url);

	// Search and label views span every tab, or a match would hide behind one.
	if (options.tabs && view === 'inbox' && !filters.q && !filters.labelId) {
		filters.tab = parseMailCategory(url.searchParams.get('tab')) ?? 'primary';
	}

	if (!db || !userId) {
		return { view, mailbox: EMPTY, filters, tabCounts: null };
	}

	const mailbox = await listMailbox(db, userId, {
		view,
		domainId,
		addressId: filters.addressId || null,
		q: filters.q,
		unreadOnly: filters.unreadOnly,
		starredOnly: filters.starredOnly,
		attachmentsOnly: filters.attachmentsOnly,
		labelId: filters.labelId || null,
		category: filters.tab || null,
		page: Number(url.searchParams.get('page')) || 1
	});

	const tabCounts = filters.tab
		? await mailStoreServiceForDb(db).countInboxUnreadByCategory(userId, domainId)
		: null;

	return { view, mailbox, filters, tabCounts };
}
