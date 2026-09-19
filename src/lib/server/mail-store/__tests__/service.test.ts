import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow } from '$lib/types';
import type {
	MailboxQuery,
	MailboxRowsPage,
	MailStoreRepository,
	NewDraftRow,
	NewEmailRow,
	ThreadMessageRow
} from '../repository';
import { createMailStoreService } from '../service';

function threadRow(overrides: Partial<ThreadMessageRow> = {}): ThreadMessageRow {
	return {
		id: 'm1',
		thread_id: 'thread-1',
		direction: 'inbound',
		from_addr: 'jane@example.com',
		from_name: 'Jane Smith',
		to_addr: 'me@example.com',
		subject: 'Hello',
		body_head: 'Hi there',
		is_read: 1,
		is_starred: 0,
		archived_at: null,
		has_attachments: 0,
		domain_id: null,
		address_id: null,
		status: null,
		created_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

function emailRow(overrides: Partial<EmailRow> = {}): EmailRow {
	return {
		id: 'email-1',
		user_id: 'user-1',
		direction: 'inbound',
		from_addr: 'jane@example.com',
		from_name: 'Jane',
		to_addr: 'me@example.com',
		cc_addr: null,
		bcc_addr: null,
		subject: 'Hello',
		body_text: 'Hi',
		body_html: null,
		message_id: null,
		in_reply_to: null,
		references_header: null,
		reply_to_email_id: null,
		thread_id: null,
		thread_key: 'hello',
		domain_id: null,
		address_id: null,
		provider_id: null,
		status: null,
		status_at: null,
		scheduled_at: null,
		send_attempts: 0,
		status_detail: null,
		is_read: 0,
		is_starred: 0,
		deleted_at: null,
		archived_at: null,
		spam_at: null,
		category: null,
		created_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

/** In-memory `MailStoreRepository` — records what the service calls it with, for assertions. */
function fakeRepo(overrides: Partial<MailStoreRepository> = {}) {
	const calls: Record<string, unknown[][]> = {};
	function record(name: string, args: unknown[]) {
		(calls[name] ??= []).push(args);
	}

	const insertedRows: NewEmailRow[] = [];
	const draftPatches: Array<{ id: string; userId: string; patch: NewDraftRow }> = [];
	let draftForUpdate: { id: string } | null = null;
	let ownedIds: string[] = [];
	let attachmentKeys: string[] = [];
	let trashedIds: string[] = [];
	const deletedBlobs: string[] = [];

	const base: MailStoreRepository = {
		getUserIdByEmail: async () => null,
		async insertRow(row) {
			record('insertRow', [row]);
			insertedRows.push(row);
		},
		conversationState: async () => ({ spam: false, category: null }),
		setCategory: async () => 0,
		countInboxUnreadByCategory: async () => ({ primary: 0, social: 0, promotions: 0, updates: 0, forums: 0 }),
		async clearArchiveForThread(userId, threadId) {
			record('clearArchiveForThread', [userId, threadId]);
		},
		async carryArchiveToReply(userId, replyId, parentId) {
			record('carryArchiveToReply', [userId, replyId, parentId]);
		},
		existsByProviderId: async () => false,
		updateStatusByProviderId: async () => {},
		getForUser: async () => null,
		async listMailboxRows(userId: string, query: MailboxQuery): Promise<MailboxRowsPage> {
			record('listMailboxRows', [userId, query]);
			return { threads: [], labels: new Map(), total: 0, page: 1, pageCount: 1, pageSize: 25 };
		},
		async listFlatRows() {
			return [];
		},
		getCursorCounts: async () => ({ messageCount: 0, latestRowid: 0 }),
		getMailboxCounts: async () => ({ inbox: 0, inbox_unread: 0, archive: 0, starred: 0, drafts: 0, sent: 0, trash: 0, spam: 0 }),
		expandToThreads: async (userId, ids) => ids,
		setFlags: async () => 0,
		async findOwnedIds(userId, ids) {
			record('findOwnedIds', [userId, ids]);
			return ownedIds.filter((id) => ids.includes(id));
		},
		async findAttachmentStorageKeys(emailIds) {
			record('findAttachmentStorageKeys', [emailIds]);
			return attachmentKeys;
		},
		async deleteAttachmentRows(emailIds) {
			record('deleteAttachmentRows', [emailIds]);
		},
		async deleteEmailRows(userId, emailIds) {
			record('deleteEmailRows', [userId, emailIds]);
		},
		async deleteBlob(bucket, storageKey) {
			deletedBlobs.push(storageKey);
		},
		markAllRead: async () => 0,
		async findTrashedIds(userId) {
			record('findTrashedIds', [userId]);
			return trashedIds;
		},
		async findDraftForUpdate(id, userId) {
			record('findDraftForUpdate', [id, userId]);
			return draftForUpdate;
		},
		async updateDraftRow(id, userId, patch) {
			draftPatches.push({ id, userId, patch });
		},
		getDraftRow: async () => null,
		deleteDraftRow: async () => {},
		listForwardThreadMessages: async () => [],
		listThreadMessages: async (userId, threadId, includeDeleted) => {
			record('listThreadMessages', [userId, threadId, includeDeleted]);
			return [];
		},
		markThreadRead: async (userId, threadId) => {
			record('markThreadRead', [userId, threadId]);
			return 0;
		},
		...overrides
	};

	return {
		repo: base,
		calls,
		insertedRows,
		draftPatches,
		deletedBlobs,
		setDraftForUpdate: (v: { id: string } | null) => (draftForUpdate = v),
		setOwnedIds: (ids: string[]) => (ownedIds = ids),
		setAttachmentKeys: (keys: string[]) => (attachmentKeys = keys),
		setTrashedIds: (ids: string[]) => (trashedIds = ids)
	};
}

describe('thin pass-throughs', () => {
	test('delegate straight to the repository with the same arguments', async () => {
		const { repo, calls } = fakeRepo({
			getUserIdByEmail: async (email) => (email === 'jane@example.com' ? 'user-1' : null),
			existsByProviderId: async (id) => id === 'prov-1',
			async updateStatusByProviderId(providerId, status, detail) {
				record('updateStatusByProviderId', [providerId, status, detail]);
			},
			getForUser: async (userId, emailId) => (userId === 'user-1' && emailId === 'e1' ? emailRow({ id: 'e1' }) : null),
			expandToThreads: async (_userId, ids) => [...ids, 'extra'],
			setFlags: async () => 3,
			markAllRead: async () => 2,
			getDraftRow: async () => emailRow({ id: 'draft-1', status: 'draft' }),
			async deleteDraftRow(userId, draftId) {
				record('deleteDraftRow', [userId, draftId]);
			},
			listForwardThreadMessages: async () => [emailRow({ id: 'fwd-1' })]
		});
		function record(name: string, args: unknown[]) {
			(calls[name] ??= []).push(args);
		}

		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		assert.equal(await service.getUserIdByEmail('jane@example.com'), 'user-1');
		assert.equal(await service.emailExistsByProviderId('prov-1'), true);
		await service.updateEmailStatusByProviderId('prov-1', 'delivered', 'ok');
		assert.deepEqual(calls.updateStatusByProviderId?.[0], ['prov-1', 'delivered', 'ok']);
		assert.equal((await service.getEmailForUser('user-1', 'e1'))?.id, 'e1');
		assert.deepEqual(await service.expandToThreads('user-1', ['a']), ['a', 'extra']);
		assert.equal(await service.setEmailFlags('user-1', ['a'], { isRead: true }), 3);
		assert.equal(await service.markAllRead('user-1'), 2);
		assert.equal((await service.getDraft('user-1', 'draft-1'))?.id, 'draft-1');
		await service.deleteDraft('user-1', 'draft-1');
		assert.deepEqual(calls.deleteDraftRow?.[0], ['user-1', 'draft-1']);
		assert.deepEqual((await service.listForwardThreadMessages('user-1', 'thread-1')).map((m) => m.id), ['fwd-1']);
	});
});

describe('insertEmail — spam stays whole per conversation', () => {
	const inbound = { userId: 'user-1', direction: 'inbound' as const, from: 'x@spam.test', to: 'me@example.com', subject: 'Hi' };
	const insertedSpam = (calls: Record<string, unknown[][]>) => (calls.insertRow?.[0]?.[0] as { spam: boolean }).spam;

	test('a spam verdict on a message that starts a conversation files it in Spam', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		await service.insertEmail({ ...inbound, spam: true });
		assert.equal(insertedSpam(calls), true);
	});

	test('a spam verdict on a reply into a normal conversation is ignored', async () => {
		const { repo, calls } = fakeRepo({ conversationState: async () => ({ spam: false, category: null }) });
		const service = createMailStoreService({ repo, resolveThread: async () => 'existing-thread' });
		await service.insertEmail({ ...inbound, spam: true });
		assert.equal(insertedSpam(calls), false);
	});

	test('any new message in a conversation already in Spam goes to Spam', async () => {
		const { repo, calls } = fakeRepo({ conversationState: async () => ({ spam: true, category: null }) });
		const service = createMailStoreService({ repo, resolveThread: async () => 'existing-thread' });
		await service.insertEmail({ ...inbound, spam: false });
		assert.equal(insertedSpam(calls), true);
	});

	test('spam mail does not pull an archived conversation back into the inbox', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		await service.insertEmail({ ...inbound, spam: true });
		assert.equal(calls.clearArchiveForThread, undefined);
	});
});

describe('insertEmail — a conversation stays in one inbox tab', () => {
	const inbound = { userId: 'user-1', direction: 'inbound' as const, from: 'news@shop.test', to: 'me@example.com', subject: 'Sale' };
	const insertedCategory = (calls: Record<string, unknown[][]>) =>
		(calls.insertRow?.[0]?.[0] as { category: string | null }).category;

	test('the rules decide the tab of a message that starts a conversation', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		await service.insertEmail({ ...inbound, category: 'promotions' });
		assert.equal(insertedCategory(calls), 'promotions');
	});

	test("a reply lands in its conversation's tab, whatever the rules said", async () => {
		const { repo, calls } = fakeRepo({ conversationState: async () => ({ spam: false, category: 'updates' }) });
		const service = createMailStoreService({ repo, resolveThread: async () => 'existing-thread' });
		await service.insertEmail({ ...inbound, category: 'promotions' });
		assert.equal(insertedCategory(calls), 'updates');
	});
});

describe('insertEmail', () => {
	test('an inbound message clears the thread archive state', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_userId, input) => input.emailId });

		await service.insertEmail({ userId: 'user-1', direction: 'inbound', from: 'jane@example.com', to: 'me@example.com', subject: 'Hi' });

		assert.equal(calls.clearArchiveForThread?.length, 1);
		assert.equal(calls.carryArchiveToReply, undefined);
	});

	test('an outbound reply carries the parent archive state forward, a fresh outbound message does not', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_userId, input) => input.emailId });

		await service.insertEmail({ userId: 'user-1', direction: 'outbound', from: 'me@example.com', to: 'jane@example.com', subject: 'Re: Hi', replyToEmailId: 'parent-1' });
		assert.equal(calls.carryArchiveToReply?.length, 1);
		assert.equal(calls.carryArchiveToReply?.[0][2], 'parent-1');

		await service.insertEmail({ userId: 'user-1', direction: 'outbound', from: 'me@example.com', to: 'jane@example.com', subject: 'New' });
		assert.equal(calls.carryArchiveToReply?.length, 1);
		assert.equal(calls.clearArchiveForThread, undefined);
	});

	test('truncates an overlong body before storing it', async () => {
		const { repo, insertedRows } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_userId, input) => input.emailId });
		const huge = 'x'.repeat(2_000_000);

		await service.insertEmail({ userId: 'user-1', direction: 'inbound', from: 'a@b.com', to: 'me@example.com', subject: 'Hi', bodyText: huge });
		assert.ok((insertedRows[0].bodyText?.length ?? 0) < huge.length);
	});
});

describe('saveDraft', () => {
	test('updates an existing draft in place instead of inserting a new row', async () => {
		const { repo, draftPatches, insertedRows, setDraftForUpdate } = fakeRepo();
		setDraftForUpdate({ id: 'draft-1' });
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		const id = await service.saveDraft('user-1', { id: 'draft-1', from: 'me@example.com', to: 'jane@example.com', subject: 'Draft' });
		assert.equal(id, 'draft-1');
		assert.equal(draftPatches.length, 1);
		assert.equal(insertedRows.length, 0);
	});

	test('creates a new draft when no id is given, or the id does not resolve to one', async () => {
		const { repo, insertedRows } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		const id = await service.saveDraft('user-1', { from: 'me@example.com', to: 'jane@example.com', subject: 'Draft' });
		assert.equal(insertedRows.length, 1);
		assert.equal(insertedRows[0].status, 'draft');
		assert.equal(insertedRows[0].id, id);
	});
});

describe('deleteEmailsPermanently', () => {
	test('is scoped to owned ids and deletes attachment blobs when a bucket is given', async () => {
		const { repo, calls, deletedBlobs, setOwnedIds, setAttachmentKeys } = fakeRepo();
		setOwnedIds(['a', 'b']);
		setAttachmentKeys(['keys/a']);
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		const bucket = {} as R2Bucket;

		const removed = await service.deleteEmailsPermanently('user-1', bucket, ['a', 'b', 'c']);
		assert.equal(removed, 2);
		assert.deepEqual(deletedBlobs, ['keys/a']);
		assert.deepEqual(calls.deleteEmailRows?.[0], ['user-1', ['a', 'b']]);
	});

	test('skips blob lookup entirely when no bucket is configured', async () => {
		const { repo, calls, setOwnedIds } = fakeRepo();
		setOwnedIds(['a']);
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		await service.deleteEmailsPermanently('user-1', undefined, ['a']);
		assert.equal(calls.findAttachmentStorageKeys, undefined);
	});

	test('is a no-op when nothing is actually owned', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		assert.equal(await service.deleteEmailsPermanently('user-1', undefined, ['a']), 0);
		assert.equal(calls.deleteEmailRows, undefined);
	});
});

describe('emptyTrash', () => {
	test('finds the trashed ids then permanently deletes them', async () => {
		const { repo, calls, setTrashedIds, setOwnedIds } = fakeRepo();
		setTrashedIds(['a', 'b']);
		setOwnedIds(['a', 'b']);
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		const removed = await service.emptyTrash('user-1', undefined);
		assert.equal(removed, 2);
		assert.deepEqual(calls.findTrashedIds?.[0], ['user-1']);
	});
});

describe('listMailbox / listEmails — row to view-model mapping', () => {
	test('builds a thread summary from a conversation\'s messages', async () => {
		const messages = [
			threadRow({ id: 'm1', created_at: '2026-01-01T00:00:00.000Z', is_read: 1 }),
			threadRow({ id: 'm2', created_at: '2026-01-02T00:00:00.000Z', subject: 'Re: Hello', is_read: 0, is_starred: 1, has_attachments: 1 })
		];
		const { repo } = fakeRepo({
			async listMailboxRows() {
				return { threads: [messages], labels: new Map(), total: 1, page: 1, pageCount: 1, pageSize: 25 };
			}
		});
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		const page = await service.listMailbox('user-1', { view: 'inbox' });
		const [summary] = page.threads;
		assert.equal(summary.subject, 'Hello');
		assert.equal(summary.message_count, 2);
		assert.equal(summary.is_read, false);
		assert.equal(summary.is_starred, true);
		assert.equal(summary.has_attachments, true);
		assert.equal(summary.latest_id, 'm2');
	});

	test('listEmails maps flat rows to summaries with a preview', async () => {
		const { repo } = fakeRepo({
			async listFlatRows() {
				return [threadRow({ body_head: 'quoted\n> older text', status: 'draft' })];
			}
		});
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		const [summary] = await service.listEmails('user-1');
		assert.equal(summary.is_draft, true);
		assert.equal(summary.status, null);
	});
});

describe('getMailboxCursor / countUnread', () => {
	test('getMailboxCursor encodes the repo\'s raw counts', async () => {
		const { repo } = fakeRepo({ getCursorCounts: async () => ({ messageCount: 9, latestRowid: 41 }) });
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		assert.equal(await service.getMailboxCursor('user-1'), '9:41');
	});

	test('countUnread reads inbox_unread off the mailbox counts', async () => {
		const { repo } = fakeRepo({
			getMailboxCounts: async () => ({ inbox: 5, inbox_unread: 3, archive: 0, starred: 0, drafts: 0, sent: 0, trash: 0, spam: 0 })
		});
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });
		assert.equal(await service.countUnread('user-1'), 3);
	});
});

describe('listThreadMessages / markThreadRead', () => {
	test('includes deleted mail only when the anchor message is itself trashed', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		await service.listThreadMessages('user-1', emailRow({ id: 'e1', thread_id: 'thread-1', deleted_at: null }));
		assert.equal(calls.listThreadMessages?.[0][2], false);

		await service.listThreadMessages('user-1', emailRow({ id: 'e2', thread_id: 'thread-1', deleted_at: '2026-01-01' }));
		assert.equal(calls.listThreadMessages?.[1][2], true);
	});

	test('markThreadRead resolves the thread id from the email, falling back to its own id', async () => {
		const { repo, calls } = fakeRepo();
		const service = createMailStoreService({ repo, resolveThread: async (_u, input) => input.emailId });

		await service.markThreadRead('user-1', emailRow({ id: 'e1', thread_id: null }));
		assert.deepEqual(calls.markThreadRead?.[0], ['user-1', 'e1']);

		await service.markThreadRead('user-1', emailRow({ id: 'e2', thread_id: 'thread-9' }));
		assert.deepEqual(calls.markThreadRead?.[1], ['user-1', 'thread-9']);
	});
});
