import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { R2Bucket } from '@cloudflare/workers-types';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1MailStoreRepository, type NewEmailRow } from '../repository';

type Row = {
	id: string;
	user_id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	from_name: string | null;
	to_addr: string;
	cc_addr: string | null;
	bcc_addr: string | null;
	subject: string;
	body_text: string | null;
	body_html: string | null;
	message_id: string | null;
	in_reply_to: string | null;
	references_header: string | null;
	reply_to_email_id: string | null;
	thread_id: string | null;
	thread_key: string | null;
	domain_id: string | null;
	address_id: string | null;
	provider_id: string | null;
	status: string | null;
	status_at: string | null;
	status_detail: string | null;
	scheduled_at: string | null;
	is_read: number;
	is_starred: number;
	deleted_at: string | null;
	archived_at: string | null;
	created_at: string;
	rowid: number;
};

type Attachment = { id: string; email_id: string; filename: string; content_type: string; size_bytes: number; created_at: string; storage_key: string | null };

function row(overrides: Partial<Row> = {}, rowid: number): Row {
	return {
		id: 'x',
		user_id: 'x',
		direction: 'inbound',
		from_addr: 'x',
		from_name: null,
		to_addr: 'x',
		cc_addr: null,
		bcc_addr: null,
		subject: '',
		body_text: null,
		body_html: null,
		message_id: null,
		in_reply_to: null,
		references_header: null,
		reply_to_email_id: null,
		thread_id: null,
		thread_key: null,
		domain_id: null,
		address_id: null,
		provider_id: null,
		status: null,
		status_at: null,
		status_detail: null,
		scheduled_at: null,
		is_read: 0,
		is_starred: 0,
		deleted_at: null,
		archived_at: null,
		created_at: '2026-01-01T00:00:00.000Z',
		rowid,
		...overrides
	};
}

function newRow(overrides: Partial<NewEmailRow> = {}): NewEmailRow {
	return {
		id: 'email-1',
		userId: 'user-1',
		direction: 'inbound',
		from: 'jane@example.com',
		fromName: 'Jane',
		to: 'me@example.com',
		cc: null,
		bcc: null,
		subject: 'Hello',
		bodyText: 'Hi there',
		bodyHtml: null,
		messageId: null,
		inReplyTo: null,
		references: null,
		replyToEmailId: null,
		threadId: 'email-1',
		threadKey: 'hello',
		domainId: null,
		addressId: null,
		providerId: null,
		status: null,
		scheduledAt: null,
		isRead: false,
		...overrides
	};
}

/** One in-memory `emails` (+ `email_attachments`) table backing every repository method. */
function setup(seedRows: Partial<Row>[] = [], seedAttachments: Attachment[] = []) {
	let nextRowid = 0;
	const rows: Row[] = seedRows.map((r) => row(r, ++nextRowid));
	const attachments: Attachment[] = seedAttachments.map((a) => ({ ...a }));

	function threadIdOf(r: Row): string {
		return r.thread_id ?? r.id;
	}

	function matchesView(r: Row, view: string): boolean {
		switch (view) {
			case 'inbox':
				return !r.deleted_at && !r.archived_at && r.direction === 'inbound';
			case 'archive':
				return !r.deleted_at && Boolean(r.archived_at) && r.status !== 'draft';
			case 'sent':
				return !r.deleted_at && r.direction === 'outbound' && r.status !== 'draft';
			case 'drafts':
				return !r.deleted_at && r.status === 'draft';
			case 'starred':
				return !r.deleted_at && r.is_starred === 1 && r.status !== 'draft';
			case 'trash':
				return Boolean(r.deleted_at);
			default:
				return false;
		}
	}

	function matchesDisplay(r: Row, view: string): boolean {
		if (view === 'trash') return Boolean(r.deleted_at);
		if (view === 'drafts') return !r.deleted_at && r.status === 'draft';
		return !r.deleted_at && r.status !== 'draft';
	}

	const db = createFakeD1(({ sql, args }) => {
		// --- core row ops ---
		if (sql === 'SELECT id FROM users WHERE email = ?') {
			return rows.filter((r) => r.from_addr === args[0]).map((r) => ({ id: r.id })); // unused in these tests
		}
		if (sql.startsWith('INSERT INTO emails')) {
			const [
				id, userId, direction, from, fromName, to, cc, bcc, subject,
				bodyText, bodyHtml, messageId, inReplyTo, references, replyToEmailId,
				threadId, threadKey, domainId, addressId, providerId, status, scheduledAt, isRead
			] = args as [
				string, string, 'inbound' | 'outbound', string, string | null, string, string | null,
				string | null, string, string | null, string | null, string | null, string | null,
				string | null, string | null, string, string, string | null, string | null,
				string | null, string | null, string | null, number
			];
			rows.push(
				row(
					{
						id, user_id: userId, direction, from_addr: from, from_name: fromName, to_addr: to,
						cc_addr: cc, bcc_addr: bcc, subject, body_text: bodyText, body_html: bodyHtml,
						message_id: messageId, in_reply_to: inReplyTo, references_header: references,
						reply_to_email_id: replyToEmailId, thread_id: threadId, thread_key: threadKey,
						domain_id: domainId, address_id: addressId, provider_id: providerId, status,
						status_at: status ? '2026-01-01' : null, scheduled_at: scheduledAt, is_read: isRead
					},
					++nextRowid
				)
			);
			return [];
		}
		if (sql.startsWith('UPDATE emails SET archived_at = NULL')) {
			const [userId, threadId] = args as [string, string];
			for (const r of rows) if (r.user_id === userId && threadIdOf(r) === threadId) r.archived_at = null;
			return [];
		}
		if (sql.includes('parent.archived_at IS NOT NULL')) {
			const [replyId, userId, parentId, parentUserId] = args as [string, string, string, string];
			const parent = rows.find((r) => r.id === parentId && r.user_id === parentUserId && r.archived_at !== null);
			if (parent) {
				const reply = rows.find((r) => r.id === replyId && r.user_id === userId);
				if (reply) reply.archived_at = '2026-01-02T00:00:00.000Z';
			}
			return [];
		}
		if (sql === 'SELECT id FROM emails WHERE provider_id = ?') {
			return rows.filter((r) => r.provider_id === args[0]).map((r) => ({ id: r.id }));
		}
		if (sql.startsWith('UPDATE emails SET status = ?')) {
			const [status, detail, providerId] = args as [string, string | null, string];
			for (const r of rows) if (r.provider_id === providerId) Object.assign(r, { status, status_detail: detail });
			return [];
		}
		if (sql === 'SELECT * FROM emails WHERE id = ? AND user_id = ?') {
			return rows.filter((r) => r.id === args[0] && r.user_id === args[1]);
		}

		// --- cursor ---
		if (sql.startsWith('SELECT COUNT(*) AS message_count')) {
			const userId = String(args[0]);
			const domainId = args[1] as string | undefined;
			const matched = rows.filter((r) => r.user_id === userId && (!domainId || r.domain_id === domainId));
			const latest = matched.reduce((max, r) => Math.max(max, r.rowid), 0);
			return [{ message_count: matched.length, latest_rowid: latest }];
		}

		// --- mailbox counts ---
		if (sql.includes('AS inbox,')) {
			const userId = String(args[0]);
			const domainId = args[1] as string | undefined;
			const scoped = rows.filter((r) => r.user_id === userId && (!domainId || r.domain_id === domainId));
			const distinctThreads = (pred: (r: Row) => boolean) => new Set(scoped.filter(pred).map(threadIdOf)).size;
			return [
				{
					inbox: distinctThreads((r) => !r.deleted_at && !r.archived_at && r.direction === 'inbound'),
					inbox_unread: distinctThreads((r) => !r.deleted_at && !r.archived_at && r.direction === 'inbound' && r.is_read === 0),
					archive: distinctThreads((r) => !r.deleted_at && Boolean(r.archived_at) && r.status !== 'draft'),
					starred: distinctThreads((r) => !r.deleted_at && r.is_starred === 1 && r.status !== 'draft'),
					drafts: distinctThreads((r) => !r.deleted_at && r.status === 'draft'),
					sent: distinctThreads((r) => !r.deleted_at && r.direction === 'outbound' && r.status !== 'draft'),
					trash: distinctThreads((r) => Boolean(r.deleted_at))
				}
			];
		}

		// --- mailbox listing (count + thread-ids-page + messages) ---
		if (sql.includes('SELECT COUNT(*) AS count FROM (')) {
			const userId = String(args[0]);
			const matched = rows.filter((r) => r.user_id === userId && matchesView(r, currentView));
			return [{ count: new Set(matched.map(threadIdOf)).size }];
		}
		if (sql.includes('MAX(datetime(m.created_at)) AS last_at')) {
			const userId = String(args[0]);
			const matched = rows.filter((r) => r.user_id === userId && matchesView(r, currentView));
			const byThread = new Map<string, Row[]>();
			for (const r of matched) {
				const list = byThread.get(threadIdOf(r)) ?? [];
				list.push(r);
				byThread.set(threadIdOf(r), list);
			}
			const entries = [...byThread.entries()]
				.map(([threadId, group]) => ({
					thread_id: threadId,
					last_at: group.reduce((max, r) => (r.created_at > max ? r.created_at : max), group[0].created_at)
				}))
				.sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
			return entries;
		}
		if (sql.includes('substr(COALESCE(m.body_text') && sql.includes('IN (')) {
			const userId = String(args[0]);
			const threadIds = args.slice(1) as string[];
			return rows
				.filter((r) => r.user_id === userId && threadIds.includes(threadIdOf(r)) && matchesDisplay(r, currentView))
				.map(toMessageRow);
		}

		// --- flat listing ---
		if (sql.includes('substr(COALESCE(e.body_text')) {
			const userId = String(args[0]);
			return rows.filter((r) => r.user_id === userId && matchesView(r, currentView)).map(toMessageRow);
		}

		// --- bulk ops ---
		if (sql.includes('COALESCE(thread_id, id) IN (')) {
			const [userId, , ...ids] = args as [string, string, ...string[]];
			const seedThreads = new Set(rows.filter((r) => r.user_id === userId && ids.includes(r.id)).map(threadIdOf));
			return rows.filter((r) => r.user_id === userId && seedThreads.has(threadIdOf(r))).map((r) => ({ id: r.id }));
		}
		if (sql.startsWith('UPDATE emails SET') && sql.includes('IN (')) {
			return applyFlagUpdate(sql, args);
		}
		if (sql.startsWith('SELECT id FROM emails WHERE user_id = ? AND id IN')) {
			const [userId, ...ids] = args as [string, ...string[]];
			return rows.filter((r) => r.user_id === userId && ids.includes(r.id)).map((r) => ({ id: r.id }));
		}
		if (sql.startsWith('SELECT storage_key FROM email_attachments')) {
			const ids = args as string[];
			return attachments.filter((a) => ids.includes(a.email_id) && a.storage_key !== null).map((a) => ({ storage_key: a.storage_key }));
		}
		if (sql.startsWith('DELETE FROM email_attachments')) {
			const ids = args as string[];
			for (let i = attachments.length - 1; i >= 0; i--) if (ids.includes(attachments[i].email_id)) attachments.splice(i, 1);
			return [];
		}
		if (sql.startsWith('DELETE FROM emails WHERE user_id')) {
			const [userId, ...ids] = args as [string, ...string[]];
			for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user_id === userId && ids.includes(rows[i].id)) rows.splice(i, 1);
			return [];
		}
		if (sql.startsWith('UPDATE emails SET is_read = 1 WHERE user_id')) {
			const [userId, domainId] = args as [string, string | undefined];
			let changes = 0;
			for (const r of rows) {
				if (r.user_id === userId && r.direction === 'inbound' && !r.deleted_at && r.is_read === 0 && (!domainId || r.domain_id === domainId)) {
					r.is_read = 1;
					changes += 1;
				}
			}
			return Array.from({ length: changes });
		}
		if (sql === 'SELECT id FROM emails WHERE user_id = ? AND deleted_at IS NOT NULL') {
			return rows.filter((r) => r.user_id === args[0] && r.deleted_at).map((r) => ({ id: r.id }));
		}

		// --- drafts ---
		if (sql.includes("status = 'draft'") && sql.startsWith('SELECT id FROM emails')) {
			const [id, userId] = args as [string, string];
			return rows.filter((r) => r.id === id && r.user_id === userId && r.status === 'draft').map((r) => ({ id: r.id }));
		}
		if (sql.startsWith('UPDATE emails SET from_addr')) {
			const [from, to, cc, bcc, subject, threadKey, bodyText, bodyHtml, domainId, addressId, id, userId] = args as [
				string, string, string | null, string | null, string, string, string | null, string | null,
				string | null, string | null, string, string
			];
			const r = rows.find((entry) => entry.id === id && entry.user_id === userId);
			if (r) Object.assign(r, { from_addr: from, to_addr: to, cc_addr: cc, bcc_addr: bcc, subject, thread_key: threadKey, body_text: bodyText, body_html: bodyHtml, domain_id: domainId, address_id: addressId, deleted_at: null });
			return [];
		}
		if (sql.includes("status = 'draft'") && sql.startsWith('SELECT * FROM emails')) {
			const [id, userId] = args as [string, string];
			return rows.filter((r) => r.id === id && r.user_id === userId && r.status === 'draft');
		}
		if (sql.startsWith('DELETE FROM emails WHERE id = ? AND user_id = ? AND status')) {
			const [id, userId] = args as [string, string];
			for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id === id && rows[i].user_id === userId && rows[i].status === 'draft') rows.splice(i, 1);
			return [];
		}

		// --- thread reads ---
		if (sql.includes('references_header, reply_to_email_id, thread_id, thread_key')) {
			throw new Error('unexpected column list');
		}
		if (sql.includes("status IS NULL OR status <> 'draft'") && sql.includes('id ASC')) {
			const [userId, threadId] = args as [string, string];
			return rows
				.filter((r) => r.user_id === userId && threadIdOf(r) === threadId && r.status !== 'draft' && !r.deleted_at)
				.sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
		}
		if (sql.includes('e.status_detail, e.scheduled_at')) {
			const [userId, threadId] = args as [string, string];
			const includeDeleted = !sql.includes('e.deleted_at IS NULL');
			return rows
				.filter((r) => r.user_id === userId && threadIdOf(r) === threadId && r.status !== 'draft' && (includeDeleted || !r.deleted_at))
				.sort((a, b) => a.created_at.localeCompare(b.created_at));
		}
		if (sql.startsWith('SELECT id, email_id, filename, content_type, size_bytes,')) {
			const ids = args as string[];
			return attachments.filter((a) => ids.includes(a.email_id));
		}
		if (sql.startsWith('UPDATE emails SET is_read = 1') && sql.includes('COALESCE(thread_id, id) = ?')) {
			const [userId, threadId] = args as [string, string];
			let changes = 0;
			for (const r of rows) {
				if (r.user_id === userId && threadIdOf(r) === threadId && !r.deleted_at && r.is_read === 0) {
					r.is_read = 1;
					changes += 1;
				}
			}
			return Array.from({ length: changes });
		}

		throw new Error(`Unhandled query in fake D1: ${sql}`);
	});

	function toMessageRow(r: Row) {
		return {
			id: r.id,
			thread_id: threadIdOf(r),
			direction: r.direction,
			from_addr: r.from_addr,
			from_name: r.from_name,
			to_addr: r.to_addr,
			subject: r.subject,
			is_read: r.is_read,
			is_starred: r.is_starred,
			archived_at: r.archived_at,
			created_at: r.created_at,
			domain_id: r.domain_id,
			address_id: r.address_id,
			status: r.status,
			body_head: r.body_text,
			has_attachments: attachments.some((a) => a.email_id === r.id) ? 1 : 0
		};
	}

	function applyFlagUpdate(sql: string, args: unknown[]) {
		const setsMatch = sql.match(/SET (.*) WHERE/s)?.[1] ?? '';
		const sets = setsMatch.split(', ');
		const idsFromTail: string[] = [];
		let cursor = 0;
		const values: unknown[] = [];
		for (const clause of sets) {
			if (clause.includes('?')) values.push(args[cursor++]);
		}
		const userId = String(args[cursor++]);
		for (let i = cursor; i < args.length; i++) idsFromTail.push(String(args[i]));

		let changes = 0;
		for (const r of rows) {
			if (r.user_id !== userId || !idsFromTail.includes(r.id)) continue;
			let vi = 0;
			for (const clause of sets) {
				if (clause.startsWith('is_read')) r.is_read = Number(values[vi++]);
				else if (clause.startsWith('is_starred')) r.is_starred = Number(values[vi++]);
				else if (clause.includes("deleted_at = datetime")) r.deleted_at = '2026-01-03T00:00:00.000Z';
				else if (clause.includes('deleted_at = NULL')) r.deleted_at = null;
				else if (clause.includes("archived_at = datetime")) r.archived_at = '2026-01-03T00:00:00.000Z';
				else if (clause.includes('archived_at = NULL')) r.archived_at = null;
			}
			changes += 1;
		}
		return Array.from({ length: changes });
	}

	let currentView = '';
	return {
		repo: createD1MailStoreRepository(db),
		rows,
		attachments,
		setView(view: string) {
			currentView = view;
		}
	};
}

describe('MailStoreRepository — core row ops', () => {
	test('getUserIdByEmail looks up by lowercased email', async () => {
		const db = createFakeD1(({ sql, args }) => {
			assert.equal(sql, 'SELECT id FROM users WHERE email = ?');
			return args[0] === 'jane@example.com' ? [{ id: 'user-1' }] : [];
		});
		const repo = createD1MailStoreRepository(db);
		assert.equal(await repo.getUserIdByEmail('Jane@Example.com'), 'user-1');
		assert.equal(await repo.getUserIdByEmail('nobody@example.com'), null);
	});

	test('insertRow then getForUser round-trips the new row', async () => {
		const { repo } = setup();
		await repo.insertRow(newRow());
		const saved = await repo.getForUser('user-1', 'email-1');
		assert.equal(saved?.subject, 'Hello');
	});

	test('clearArchiveForThread un-archives every message in the thread', async () => {
		const { repo, rows } = setup([
			{ id: 'a', user_id: 'user-1', thread_id: 'thread-1', archived_at: '2026-01-01' },
			{ id: 'b', user_id: 'user-1', thread_id: 'thread-1', archived_at: '2026-01-01' }
		]);
		await repo.clearArchiveForThread('user-1', 'thread-1');
		assert.ok(rows.every((r) => r.archived_at === null));
	});

	test('carryArchiveToReply only archives the reply when the parent is archived', async () => {
		const { repo, rows } = setup([
			{ id: 'parent', user_id: 'user-1', archived_at: '2026-01-01' },
			{ id: 'reply', user_id: 'user-1', archived_at: null }
		]);
		await repo.carryArchiveToReply('user-1', 'reply', 'parent');
		assert.ok(rows.find((r) => r.id === 'reply')?.archived_at);
	});

	test('existsByProviderId and updateStatusByProviderId', async () => {
		const { repo, rows } = setup([{ id: 'a', provider_id: 'prov-1', status: 'queued' }]);
		assert.equal(await repo.existsByProviderId('prov-1'), true);
		assert.equal(await repo.existsByProviderId('missing'), false);

		await repo.updateStatusByProviderId('prov-1', 'delivered', 'ok');
		assert.equal(rows[0].status, 'delivered');
		assert.equal(rows[0].status_detail, 'ok');
	});

	test('getForUser is ownership-scoped', async () => {
		const { repo } = setup([{ id: 'a', user_id: 'user-1' }]);
		assert.equal((await repo.getForUser('user-1', 'a'))?.id, 'a');
		assert.equal(await repo.getForUser('someone-else', 'a'), null);
	});
});

describe('MailStoreRepository — cursor and counts', () => {
	test('getCursorCounts reports the message count and highest rowid, scoped to a domain', async () => {
		const { repo } = setup([
			{ id: 'a', user_id: 'user-1', domain_id: 'd1' },
			{ id: 'b', user_id: 'user-1', domain_id: 'd2' }
		]);
		assert.deepEqual(await repo.getCursorCounts('user-1'), { messageCount: 2, latestRowid: 2 });
		assert.deepEqual(await repo.getCursorCounts('user-1', 'd1'), { messageCount: 1, latestRowid: 1 });
	});

	test('getMailboxCounts buckets by view, counting conversations not messages', async () => {
		const { repo } = setup([
			{ id: 'a', user_id: 'user-1', direction: 'inbound', thread_id: 'thread-1', is_read: 0 },
			{ id: 'b', user_id: 'user-1', direction: 'outbound', thread_id: 'thread-1', status: null },
			{ id: 'c', user_id: 'user-1', deleted_at: '2026-01-02' }
		]);
		const counts = await repo.getMailboxCounts('user-1');
		assert.equal(counts.inbox, 1);
		assert.equal(counts.inbox_unread, 1);
		assert.equal(counts.trash, 1);
	});
});

describe('MailStoreRepository — mailbox listing', () => {
	test('listMailboxRows groups messages by conversation, newest thread first', async () => {
		const { repo, setView } = setup([
			{ id: 'a', user_id: 'user-1', direction: 'inbound', thread_id: 'thread-1', created_at: '2026-01-01T00:00:00.000Z' },
			{ id: 'b', user_id: 'user-1', direction: 'inbound', thread_id: 'thread-1', created_at: '2026-01-01T01:00:00.000Z' },
			{ id: 'c', user_id: 'user-1', direction: 'inbound', thread_id: 'thread-2', created_at: '2026-01-02T00:00:00.000Z' }
		]);
		setView('inbox');
		const page = await repo.listMailboxRows('user-1', { view: 'inbox' });
		assert.equal(page.total, 2);
		assert.deepEqual(page.threads.map((group) => group[0].thread_id), ['thread-2', 'thread-1']);
		assert.equal(page.threads.find((g) => g[0].thread_id === 'thread-1')?.length, 2);
	});

	test('listMailboxRows returns an empty page when nothing matches', async () => {
		const { repo, setView } = setup();
		setView('inbox');
		const page = await repo.listMailboxRows('user-1', { view: 'inbox' });
		assert.deepEqual(page, { threads: [], total: 0, page: 1, pageCount: 1, pageSize: 25 });
	});

	test('listFlatRows defaults to inbox for inbound and sent for outbound', async () => {
		const { repo, setView } = setup([
			{ id: 'a', user_id: 'user-1', direction: 'inbound' },
			{ id: 'b', user_id: 'user-1', direction: 'outbound', status: null }
		]);
		setView('inbox');
		assert.deepEqual((await repo.listFlatRows('user-1', {})).map((r) => r.id), ['a']);
		setView('sent');
		assert.deepEqual((await repo.listFlatRows('user-1', { direction: 'outbound' })).map((r) => r.id), ['b']);
	});

	test('a free-text search escapes LIKE wildcards in the term before binding it', async () => {
		let likeBinding: unknown;
		const db = createFakeD1(({ sql, args }) => {
			if (sql.includes('SELECT COUNT(*) AS count FROM (')) {
				likeBinding = args[args.length - 1];
				return [{ count: 0 }];
			}
			return [];
		});
		const repo = createD1MailStoreRepository(db);

		await repo.listMailboxRows('user-1', { view: 'inbox', q: '50%_off\\now' });
		// A literal backslash, percent and underscore in the search box must not
		// be interpreted as SQL LIKE wildcards or escape the escape character.
		assert.equal(likeBinding, '%50\\%\\_off\\\\now%');
	});
});

describe('MailStoreRepository — bulk ops', () => {
	test('expandToThreads widens a selection to every message in the same conversations', async () => {
		const { repo } = setup([
			{ id: 'a', user_id: 'user-1', thread_id: 'thread-1' },
			{ id: 'b', user_id: 'user-1', thread_id: 'thread-1' },
			{ id: 'c', user_id: 'user-1', thread_id: 'thread-2' }
		]);
		assert.deepEqual(new Set(await repo.expandToThreads('user-1', ['a'])), new Set(['a', 'b']));
		assert.deepEqual(await repo.expandToThreads('user-1', []), []);
	});

	test('setFlags applies only the given flags, scoped to the owner', async () => {
		const { repo, rows } = setup([{ id: 'a', user_id: 'user-1', is_read: 0 }]);
		const changed = await repo.setFlags('user-1', ['a'], { isRead: true, archived: true });
		assert.equal(changed, 1);
		assert.equal(rows[0].is_read, 1);
		assert.ok(rows[0].archived_at);
	});

	test('setFlags with no fields set is a no-op', async () => {
		const { repo } = setup([{ id: 'a', user_id: 'user-1' }]);
		assert.equal(await repo.setFlags('user-1', ['a'], {}), 0);
	});

	test('markAllRead only touches unread inbound mail, optionally scoped to a domain', async () => {
		const { repo, rows } = setup([
			{ id: 'a', user_id: 'user-1', direction: 'inbound', is_read: 0, domain_id: 'd1' },
			{ id: 'b', user_id: 'user-1', direction: 'inbound', is_read: 0, domain_id: 'd2' }
		]);
		const changed = await repo.markAllRead('user-1', 'd1');
		assert.equal(changed, 1);
		assert.equal(rows.find((r) => r.id === 'a')?.is_read, 1);
		assert.equal(rows.find((r) => r.id === 'b')?.is_read, 0);
	});

	test('findTrashedIds only returns deleted rows for that user', async () => {
		const { repo } = setup([
			{ id: 'a', user_id: 'user-1', deleted_at: '2026-01-01' },
			{ id: 'b', user_id: 'user-1' }
		]);
		assert.deepEqual(await repo.findTrashedIds('user-1'), ['a']);
	});
});

describe('MailStoreRepository — permanent delete', () => {
	function attachmentSetup() {
		const { repo, rows, attachments } = setup(
			[{ id: 'a', user_id: 'user-1' }, { id: 'b', user_id: 'user-1' }],
			[{ id: 'att-1', email_id: 'a', filename: 'f', content_type: 'image/png', size_bytes: 1, created_at: 't', storage_key: 'keys/a' }]
		);
		const stored = new Set(['keys/a']);
		const bucket = { async delete(key: string) { stored.delete(key); } } as unknown as R2Bucket;
		return { repo, rows, attachments, bucket, stored };
	}

	test('findOwnedIds only returns rows the user actually owns', async () => {
		const { repo } = attachmentSetup();
		assert.deepEqual(await repo.findOwnedIds('user-1', ['a', 'b', 'c']), ['a', 'b']);
	});

	test('findAttachmentStorageKeys skips null keys', async () => {
		const { repo } = attachmentSetup();
		assert.deepEqual(await repo.findAttachmentStorageKeys(['a', 'b']), ['keys/a']);
	});

	test('deleteBlob removes the object from the bucket', async () => {
		const { repo, bucket, stored } = attachmentSetup();
		await repo.deleteBlob(bucket, 'keys/a');
		assert.equal(stored.has('keys/a'), false);
	});

	test('deleteAttachmentRows / deleteEmailRows delete the given rows and are no-ops for an empty list', async () => {
		const { repo, rows, attachments } = attachmentSetup();
		await repo.deleteAttachmentRows([]);
		await repo.deleteEmailRows('user-1', []);
		assert.equal(rows.length, 2);
		assert.equal(attachments.length, 1);

		await repo.deleteAttachmentRows(['a']);
		await repo.deleteEmailRows('user-1', ['a']);
		assert.equal(rows.length, 1);
		assert.equal(attachments.length, 0);
	});
});

describe('MailStoreRepository — drafts', () => {
	test('findDraftForUpdate is scoped to the owner and to draft status', async () => {
		const { repo } = setup([{ id: 'draft-1', user_id: 'user-1', status: 'draft' }]);
		assert.equal((await repo.findDraftForUpdate('draft-1', 'user-1'))?.id, 'draft-1');
		assert.equal(await repo.findDraftForUpdate('draft-1', 'someone-else'), null);
	});

	test('updateDraftRow overwrites the editable fields and clears deleted_at', async () => {
		const { repo, rows } = setup([{ id: 'draft-1', user_id: 'user-1', status: 'draft', deleted_at: '2026-01-01' }]);
		await repo.updateDraftRow('draft-1', 'user-1', {
			from: 'me@example.com',
			to: 'you@example.com',
			cc: null,
			bcc: null,
			subject: 'Updated',
			threadKey: 'updated',
			bodyText: 'new body',
			bodyHtml: null,
			domainId: null,
			addressId: null
		});
		assert.equal(rows[0].subject, 'Updated');
		assert.equal(rows[0].deleted_at, null);
	});

	test('getDraftRow / deleteDraftRow are scoped to draft status', async () => {
		const { repo, rows } = setup([{ id: 'draft-1', user_id: 'user-1', status: 'draft' }]);
		assert.equal((await repo.getDraftRow('user-1', 'draft-1'))?.id, 'draft-1');
		await repo.deleteDraftRow('user-1', 'draft-1');
		assert.equal(rows.length, 0);
	});
});

describe('MailStoreRepository — thread reads', () => {
	test('listForwardThreadMessages rejects cross-user messages and returns the owned thread oldest first', async () => {
		const { repo } = setup([
			{ id: 'newer', user_id: 'user-1', thread_id: 'thread-1', created_at: '2026-02-02' },
			{ id: 'other-user', user_id: 'user-2', thread_id: 'thread-1', created_at: '2026-01-01' },
			{ id: 'older', user_id: 'user-1', thread_id: 'thread-1', created_at: '2026-02-01' },
			{ id: 'draft', user_id: 'user-1', thread_id: 'thread-1', status: 'draft', created_at: '2026-02-03' },
			{ id: 'trashed', user_id: 'user-1', thread_id: 'thread-1', deleted_at: '2026-02-04', created_at: '2026-02-04' }
		]);
		assert.deepEqual(
			(await repo.listForwardThreadMessages('user-1', 'thread-1')).map((r) => r.id),
			['older', 'newer']
		);
		assert.deepEqual(await repo.listForwardThreadMessages('user-3', 'thread-1'), []);
	});

	test('listThreadMessages merges in attachments and includes deleted mail only when asked', async () => {
		const { repo } = setup(
			[
				{ id: 'a', user_id: 'user-1', thread_id: 'thread-1', created_at: '2026-01-01', is_read: 1, is_starred: 0 },
				{ id: 'b', user_id: 'user-1', thread_id: 'thread-1', created_at: '2026-01-02', deleted_at: '2026-01-03', is_read: 1, is_starred: 0 }
			],
			[{ id: 'att-1', email_id: 'a', filename: 'f.png', content_type: 'image/png', size_bytes: 2, created_at: 't', storage_key: 'k' }]
		);

		const live = await repo.listThreadMessages('user-1', 'thread-1', false);
		assert.deepEqual(live.map((m) => m.id), ['a']);
		assert.equal(live[0].attachments.length, 1);
		assert.equal(live[0].is_read, true);

		const all = await repo.listThreadMessages('user-1', 'thread-1', true);
		assert.deepEqual(all.map((m) => m.id), ['a', 'b']);
	});

	test('markThreadRead clears unread on the whole thread and reports how many changed', async () => {
		const { repo, rows } = setup([
			{ id: 'a', user_id: 'user-1', thread_id: 'thread-1', is_read: 0 },
			{ id: 'b', user_id: 'user-1', thread_id: 'thread-1', is_read: 0 }
		]);
		assert.equal(await repo.markThreadRead('user-1', 'thread-1'), 2);
		assert.ok(rows.every((r) => r.is_read === 1));
	});
});
