import { error, type LoadEvent } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { page } from '$app/state';
import {
	mailboxKey,
	readMailboxSnapshot,
	saveMailboxSnapshot,
	snapshotGeneration,
	type MailboxData
} from './mailbox-cache';
import type { MailboxView } from '$lib/types';

type LayoutScope = { user?: { id: string } | null; activeDomainId?: string | null };

/**
 * Shared by every mailbox route. Navigating to a list seen earlier renders its
 * snapshot without a request; re-running on the same list (an invalidation,
 * or opening a thread over it) always reads it fresh.
 */
export async function loadMailboxPage(
	event: Pick<LoadEvent, 'url' | 'fetch' | 'parent'>,
	folder: MailboxView
): Promise<MailboxData> {
	const { url, fetch } = event;
	const { user, activeDomainId } = (await event.parent()) as LayoutScope;
	const owner = `${user?.id ?? ''}|${activeDomainId ?? ''}`;
	const key = mailboxKey(url);

	if (browser && page.url && mailboxKey(page.url) !== key) {
		const snapshot = readMailboxSnapshot(owner, key);
		if (snapshot) return snapshot;
	}

	const startedAt = snapshotGeneration();
	const params = new URLSearchParams(url.searchParams);
	params.set('folder', folder);
	const response = await fetch(`/api/mail/list?${params}`);
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };
		error(response.status, body.error ?? 'Could not load mail');
	}

	const data = (await response.json()) as MailboxData;
	if (browser) saveMailboxSnapshot(owner, key, data, startedAt);
	return data;
}
