import type { MailCategory } from './categories';
import type { MailboxFilters, MailboxPage, MailboxView } from '$lib/types';

export type MailboxData = {
	view: MailboxView;
	mailbox: MailboxPage;
	filters: MailboxFilters;
	tabCounts: Record<MailCategory, number> | null;
	/** The mailbox sync cursor at the moment the list was read. */
	cursor: string;
};

/** Params that open something over the list without changing which rows it shows. */
const OVERLAY_PARAMS = new Set(['thread', 'compose', 'draft']);
const MAX_SNAPSHOTS = 30;

type Snapshot = { data: MailboxData; generation: number };

/**
 * The last list shown for each mailbox URL, so going back to one renders at
 * once. A snapshot is only reused while the sync cursor still matches it (no
 * mail arrived or was deleted) and no write was made since it was read.
 */
const snapshots = new Map<string, Snapshot>();
let scope: string | null = null;
let generation = 0;
let liveCursor: string | null = null;

export function mailboxKey(url: URL): string {
	const params = [...url.searchParams.entries()]
		.filter(([name]) => !OVERLAY_PARAMS.has(name))
		.sort(([a], [b]) => a.localeCompare(b));
	return `${url.pathname}?${new URLSearchParams(params).toString()}`;
}

/** Called by live sync whenever it learns the server's current cursor. */
export function setMailboxCursor(cursor: string | null): void {
	liveCursor = cursor;
}

/** Any write to mail can change any list; drop them all, and ignore reads already in flight. */
export function forgetMailboxSnapshots(): void {
	generation += 1;
	snapshots.clear();
}

/** Taken before a list is fetched, so a write made while it was in flight discards it. */
export function snapshotGeneration(): number {
	return generation;
}

/** Snapshots belong to one account and domain; switching either drops them. */
function useScope(next: string): void {
	if (scope === next) return;
	scope = next;
	snapshots.clear();
}

export function readMailboxSnapshot(owner: string, key: string): MailboxData | null {
	useScope(owner);
	const hit = snapshots.get(key);
	if (!hit) return null;
	if (hit.generation !== generation || liveCursor === null || hit.data.cursor !== liveCursor) {
		snapshots.delete(key);
		return null;
	}
	return structuredClone(hit.data);
}

export function saveMailboxSnapshot(owner: string, key: string, data: MailboxData, startedAt: number): void {
	useScope(owner);
	if (startedAt !== generation) return;
	snapshots.delete(key);
	snapshots.set(key, { data: structuredClone(data), generation });
	if (snapshots.size > MAX_SNAPSHOTS) {
		const oldest = snapshots.keys().next().value;
		if (oldest !== undefined) snapshots.delete(oldest);
	}
}

/**
 * Opening a conversation marks it read on the server. Patch that into the
 * snapshots instead of dropping them, so going back to the list stays instant.
 * Lists already in flight may predate the read, so they are still discarded.
 */
export function markThreadReadInSnapshots(threadId: string): void {
	generation += 1;
	let tab: MailCategory | null = null;
	const alreadyRead = new Set<Snapshot>();
	for (const [key, snapshot] of snapshots) {
		snapshot.generation = generation;
		const { data } = snapshot;
		const row = data.mailbox.threads.find((thread) => thread.thread_id === threadId);
		if (!row) continue;
		if (row.is_read) {
			alreadyRead.add(snapshot);
			continue;
		}
		tab ??= (data.filters.tab as MailCategory | '') || null;
		if (data.filters.unreadOnly) {
			snapshots.delete(key);
			continue;
		}
		row.is_read = true;
	}
	if (!tab) return;
	// Every inbox list carries the counts of all tabs, not only its own, so the
	// thread's tab drops in each of them: Primary's list shows Promotions' badge too.
	for (const snapshot of snapshots.values()) {
		const counts = snapshot.data.tabCounts;
		if (counts && !alreadyRead.has(snapshot)) counts[tab] = Math.max(0, counts[tab] - 1);
	}
}
