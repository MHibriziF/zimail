import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
	forgetMailboxSnapshots,
	mailboxKey,
	markThreadReadInSnapshots,
	readMailboxSnapshot,
	saveMailboxSnapshot,
	setMailboxCursor,
	snapshotGeneration,
	type MailboxData
} from '../mailbox-cache';
import type { ThreadSummary } from '$lib/types';

const OWNER = 'user-1|';

function thread(id: string, isRead: boolean): ThreadSummary {
	return {
		thread_id: id,
		latest_id: id,
		subject: 'Hello',
		preview: '',
		participants: [],
		message_count: 1,
		is_read: isRead,
		is_starred: false,
		is_draft: false,
		is_archived: false,
		has_attachments: false,
		domain_id: null,
		address_id: null,
		status: null,
		labels: [],
		created_at: '2026-11-06 10:00:00'
	};
}

function list(cursor: string, threads: ThreadSummary[], overrides: Partial<MailboxData['filters']> = {}): MailboxData {
	return {
		view: 'inbox',
		mailbox: { threads, total: threads.length, page: 1, pageCount: 1, pageSize: 25 },
		filters: {
			q: '',
			unreadOnly: false,
			starredOnly: false,
			attachmentsOnly: false,
			addressId: '',
			labelId: '',
			tab: 'primary',
			...overrides
		},
		tabCounts: { primary: 1, promotions: 0, social: 0, updates: 0 } as MailboxData['tabCounts'],
		cursor
	};
}

function save(key: string, data: MailboxData) {
	saveMailboxSnapshot(OWNER, key, data, snapshotGeneration());
}

beforeEach(() => {
	forgetMailboxSnapshots();
	setMailboxCursor('5:50');
});

test('keys ignore what opens over the list, and param order', () => {
	const a = mailboxKey(new URL('https://x.test/inbox?tab=social&page=2&thread=t1'));
	const b = mailboxKey(new URL('https://x.test/inbox?page=2&tab=social&compose=1&draft=d'));
	assert.equal(a, b);
	assert.notEqual(a, mailboxKey(new URL('https://x.test/inbox?tab=social')));
});

test('a snapshot is reused while the cursor still matches', () => {
	save('/inbox?', list('5:50', [thread('t1', true)]));
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?')?.mailbox.threads.length, 1);
});

test('new or deleted mail moves the cursor and retires the snapshot', () => {
	save('/inbox?', list('5:50', [thread('t1', true)]));
	setMailboxCursor('6:51');
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?'), null);
});

test('nothing is reused before live sync has reported a cursor', () => {
	save('/inbox?', list('5:50', []));
	setMailboxCursor(null);
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?'), null);
});

test('a write drops every snapshot, and a list read before it lands is not kept', () => {
	save('/inbox?', list('5:50', []));
	const startedAt = snapshotGeneration();
	forgetMailboxSnapshots();
	saveMailboxSnapshot(OWNER, '/starred?', list('5:50', []), startedAt);
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?'), null);
	assert.equal(readMailboxSnapshot(OWNER, '/starred?'), null);
});

test('another account or domain never sees the previous one\'s lists', () => {
	save('/inbox?', list('5:50', [thread('t1', true)]));
	assert.equal(readMailboxSnapshot('user-2|', '/inbox?'), null);
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?'), null);
});

test('reading a thread patches it read and lowers its tab count', () => {
	save('/inbox?', list('5:50', [thread('t1', false), thread('t2', false)]));
	markThreadReadInSnapshots('t1');
	const hit = readMailboxSnapshot(OWNER, '/inbox?');
	assert.deepEqual(hit?.mailbox.threads.map((row) => row.is_read), [true, false]);
	assert.equal(hit?.tabCounts?.primary, 0);
});

test('reading a thread in one tab lowers that tab\'s badge on the other tabs\' lists', () => {
	const counts = { primary: 0, promotions: 1, social: 0, updates: 0 } as MailboxData['tabCounts'];
	save('/inbox?', { ...list('5:50', [thread('p1', true)]), tabCounts: structuredClone(counts) });
	save('/inbox?tab=promotions', {
		...list('5:50', [thread('t1', false)], { tab: 'promotions' }),
		tabCounts: structuredClone(counts)
	});
	markThreadReadInSnapshots('t1');
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?')?.tabCounts?.promotions, 0);
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?tab=promotions')?.tabCounts?.promotions, 0);
});

test('a list that already shows the thread read keeps its counts', () => {
	save('/inbox?tab=promotions', {
		...list('5:50', [thread('t1', false)], { tab: 'promotions' }),
		tabCounts: { primary: 0, promotions: 2, social: 0, updates: 0 } as MailboxData['tabCounts']
	});
	save('/inbox?tab=promotions&starred=1', {
		...list('5:50', [thread('t1', true)], { tab: 'promotions' }),
		tabCounts: { primary: 0, promotions: 1, social: 0, updates: 0 } as MailboxData['tabCounts']
	});
	markThreadReadInSnapshots('t1');
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?tab=promotions')?.tabCounts?.promotions, 1);
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?tab=promotions&starred=1')?.tabCounts?.promotions, 1);
});

test('reading a thread drops unread-only lists, which it would leave', () => {
	save('/inbox?unread=1', list('5:50', [thread('t1', false)], { unreadOnly: true }));
	markThreadReadInSnapshots('t1');
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?unread=1'), null);
});

test('a list in flight while a thread was read is not kept', () => {
	const startedAt = snapshotGeneration();
	markThreadReadInSnapshots('t1');
	saveMailboxSnapshot(OWNER, '/inbox?', list('5:50', [thread('t1', false)]), startedAt);
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?'), null);
});

test('callers get copies, so editing a rendered list never edits the snapshot', () => {
	save('/inbox?', list('5:50', [thread('t1', true)]));
	const first = readMailboxSnapshot(OWNER, '/inbox?');
	first?.mailbox.threads.pop();
	assert.equal(readMailboxSnapshot(OWNER, '/inbox?')?.mailbox.threads.length, 1);
});
