import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { MAILBOX_PAGE_SIZE } from '$lib/constants';
import type {
	DeliveryStatus,
	EmailAttachmentMeta,
	EmailRow,
	MailboxCounts,
	MailboxView,
	MailStatus,
	ThreadMessage
} from '$lib/types';

/**
 * Every mailbox is a slice of the same table: Drafts are unsent outbound rows,
 * Trash is anything with `deleted_at`, and the rest hide trashed mail. A
 * conversation shows up in a mailbox when any of its messages match.
 */
function viewFilter(view: MailboxView): string {
	switch (view) {
		case 'inbox':
			return "e.deleted_at IS NULL AND e.archived_at IS NULL AND e.direction = 'inbound'";
		case 'archive':
			return "e.deleted_at IS NULL AND e.archived_at IS NOT NULL AND (e.status IS NULL OR e.status <> 'draft')";
		case 'sent':
			return "e.deleted_at IS NULL AND e.direction = 'outbound' AND (e.status IS NULL OR e.status <> 'draft')";
		case 'drafts':
			return "e.deleted_at IS NULL AND e.status = 'draft'";
		case 'starred':
			return "e.deleted_at IS NULL AND e.is_starred = 1 AND (e.status IS NULL OR e.status <> 'draft')";
		case 'trash':
			return 'e.deleted_at IS NOT NULL';
	}
}

/**
 * Which messages of a matched conversation are actually rendered. Wider than
 * `viewFilter` on purpose — an inbox row counts the replies we sent too, so it
 * reads as one conversation rather than a matched message.
 */
function displayFilter(view: MailboxView, alias: string): string {
	switch (view) {
		case 'trash':
			return `${alias}.deleted_at IS NOT NULL`;
		case 'drafts':
			return `${alias}.deleted_at IS NULL AND ${alias}.status = 'draft'`;
		default:
			return `${alias}.deleted_at IS NULL AND (${alias}.status IS NULL OR ${alias}.status <> 'draft')`;
	}
}

export type MailboxQuery = {
	view: MailboxView;
	/** Restrict to one connected domain; omit for the combined view. */
	domainId?: string | null;
	/** Restrict to one registered address, for users with several mailboxes. */
	addressId?: string | null;
	/** Free text matched against participants, subject and body. */
	q?: string | null;
	unreadOnly?: boolean;
	starredOnly?: boolean;
	attachmentsOnly?: boolean;
	page?: number;
	pageSize?: number;
};

export type ThreadMessageRow = {
	id: string;
	thread_id: string;
	direction: 'inbound' | 'outbound';
	from_addr: string;
	from_name: string | null;
	to_addr: string;
	subject: string;
	body_head: string | null;
	is_read: number;
	is_starred: number;
	archived_at: string | null;
	has_attachments: number;
	domain_id: string | null;
	address_id: string | null;
	status: MailStatus | null;
	created_at: string;
};

export type MailboxRowsPage = {
	/** Each entry is one conversation's messages, oldest first. */
	threads: ThreadMessageRow[][];
	total: number;
	page: number;
	pageCount: number;
	pageSize: number;
};

/** Builds the WHERE clause and bindings shared by the count and the page query. */
function buildScope(userId: string, query: MailboxQuery): { where: string; bindings: unknown[] } {
	const filters = ['e.user_id = ?', viewFilter(query.view)];
	const bindings: unknown[] = [userId];

	if (query.domainId) {
		filters.push('e.domain_id = ?');
		bindings.push(query.domainId);
	}

	if (query.addressId) {
		filters.push('e.address_id = ?');
		bindings.push(query.addressId);
	}

	const term = query.q?.trim();
	if (term) {
		filters.push(
			String.raw`(e.subject LIKE ? ESCAPE '\' OR e.from_addr LIKE ? ESCAPE '\'
			  OR e.to_addr LIKE ? ESCAPE '\' OR e.body_text LIKE ? ESCAPE '\')`
		);
		const escaped = term
			.replaceAll('\\', String.raw`\\`)
			.replaceAll('%', String.raw`\%`)
			.replaceAll('_', String.raw`\_`);
		const like = `%${escaped}%`;
		bindings.push(like, like, like, like);
	}

	if (query.unreadOnly) filters.push('e.is_read = 0');
	if (query.starredOnly) filters.push('e.is_starred = 1');
	if (query.attachmentsOnly) {
		filters.push('EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id)');
	}

	return { where: filters.join(' AND '), bindings };
}

export type NewEmailRow = {
	id: string;
	userId: string;
	direction: 'inbound' | 'outbound';
	from: string;
	fromName: string | null;
	to: string;
	cc: string | null;
	bcc: string | null;
	subject: string;
	bodyText: string | null;
	bodyHtml: string | null;
	messageId: string | null;
	inReplyTo: string | null;
	references: string | null;
	replyToEmailId: string | null;
	threadId: string;
	threadKey: string;
	domainId: string | null;
	addressId: string | null;
	providerId: string | null;
	status: MailStatus | null;
	scheduledAt: string | null;
	isRead: boolean;
};

export type MailFlagUpdate = {
	isRead?: boolean;
	isStarred?: boolean;
	trashed?: boolean;
	archived?: boolean;
};

export type NewDraftRow = {
	from: string;
	to: string;
	cc: string | null;
	bcc: string | null;
	subject: string;
	threadKey: string;
	bodyText: string | null;
	bodyHtml: string | null;
	domainId: string | null;
	addressId: string | null;
};

/**
 * Raw D1 (+ R2, for the permanent-delete methods) access for the `emails`
 * table — thin wrappers and view→SQL translation, no business rules. See
 * `./service.ts` for the archive rules, draft branching, and the
 * ownership→blobs→rows delete sequencing built on top of these.
 */
export type MailStoreRepository = {
	getUserIdByEmail(email: string): Promise<string | null>;
	insertRow(row: NewEmailRow): Promise<void>;
	/** A new inbound reply brings an archived conversation back to the inbox. */
	clearArchiveForThread(userId: string, threadId: string): Promise<void>;
	/** Sending a reply from an archived conversation should not silently move it back. */
	carryArchiveToReply(userId: string, replyId: string, parentId: string): Promise<void>;
	existsByProviderId(providerId: string): Promise<boolean>;
	updateStatusByProviderId(
		providerId: string,
		status: DeliveryStatus,
		detail: string | null
	): Promise<void>;
	getForUser(userId: string, emailId: string): Promise<EmailRow | null>;

	listMailboxRows(userId: string, query: MailboxQuery): Promise<MailboxRowsPage>;
	listFlatRows(
		userId: string,
		options: { direction?: 'inbound' | 'outbound'; domainId?: string | null; limit?: number }
	): Promise<ThreadMessageRow[]>;

	getCursorCounts(
		userId: string,
		domainId?: string | null
	): Promise<{ messageCount: number; latestRowid: number }>;
	getMailboxCounts(userId: string, domainId?: string | null): Promise<MailboxCounts>;

	expandToThreads(userId: string, ids: string[]): Promise<string[]>;
	setFlags(userId: string, ids: string[], update: MailFlagUpdate): Promise<number>;
	findOwnedIds(userId: string, ids: string[]): Promise<string[]>;
	findAttachmentStorageKeys(emailIds: string[]): Promise<string[]>;
	deleteAttachmentRows(emailIds: string[]): Promise<void>;
	deleteEmailRows(userId: string, emailIds: string[]): Promise<void>;
	deleteBlob(bucket: R2Bucket, storageKey: string): Promise<void>;
	markAllRead(userId: string, domainId?: string | null): Promise<number>;
	findTrashedIds(userId: string): Promise<string[]>;

	findDraftForUpdate(id: string, userId: string): Promise<{ id: string } | null>;
	updateDraftRow(id: string, userId: string, patch: NewDraftRow): Promise<void>;
	getDraftRow(userId: string, draftId: string): Promise<EmailRow | null>;
	deleteDraftRow(userId: string, draftId: string): Promise<void>;

	listForwardThreadMessages(userId: string, threadId: string): Promise<EmailRow[]>;
	listThreadMessages(userId: string, threadId: string, includeDeleted: boolean): Promise<ThreadMessage[]>;
	markThreadRead(userId: string, threadId: string): Promise<number>;
};

export function createD1MailStoreRepository(db: D1Database): MailStoreRepository {
	return {
		async getUserIdByEmail(email) {
			const row = await db
				.prepare('SELECT id FROM users WHERE email = ?')
				.bind(email.toLowerCase())
				.first<{ id: string }>();
			return row?.id ?? null;
		},

		async insertRow(row) {
			await db
				.prepare(
					`INSERT INTO emails (
						id, user_id, direction, from_addr, from_name, to_addr, cc_addr, bcc_addr, subject,
						body_text, body_html, message_id, in_reply_to, references_header,
						reply_to_email_id, thread_id, thread_key,
						domain_id, address_id, provider_id, status, status_at, scheduled_at, is_read
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
				)
				.bind(
					row.id,
					row.userId,
					row.direction,
					row.from,
					row.fromName,
					row.to,
					row.cc,
					row.bcc,
					row.subject,
					row.bodyText,
					row.bodyHtml,
					row.messageId,
					row.inReplyTo,
					row.references,
					row.replyToEmailId,
					row.threadId,
					row.threadKey,
					row.domainId,
					row.addressId,
					row.providerId,
					row.status,
					row.scheduledAt,
					row.isRead ? 1 : 0
				)
				.run();
		},

		async clearArchiveForThread(userId, threadId) {
			await db
				.prepare(
					`UPDATE emails SET archived_at = NULL
					 WHERE user_id = ? AND COALESCE(thread_id, id) = ?`
				)
				.bind(userId, threadId)
				.run();
		},

		async carryArchiveToReply(userId, replyId, parentId) {
			await db
				.prepare(
					`UPDATE emails SET archived_at = datetime('now')
					 WHERE id = ? AND user_id = ?
					   AND EXISTS (
					     SELECT 1 FROM emails parent
					     WHERE parent.id = ? AND parent.user_id = ? AND parent.archived_at IS NOT NULL
					   )`
				)
				.bind(replyId, userId, parentId, userId)
				.run();
		},

		async existsByProviderId(providerId) {
			const row = await db
				.prepare('SELECT id FROM emails WHERE provider_id = ?')
				.bind(providerId)
				.first<{ id: string }>();
			return Boolean(row);
		},

		async updateStatusByProviderId(providerId, status, detail) {
			await db
				.prepare(
					`UPDATE emails SET status = ?, status_at = datetime('now'), status_detail = ?
					 WHERE provider_id = ?`
				)
				.bind(status, detail, providerId)
				.run();
		},

		async getForUser(userId, emailId) {
			const row = await db
				.prepare('SELECT * FROM emails WHERE id = ? AND user_id = ?')
				.bind(emailId, userId)
				.first<EmailRow>();
			return row ?? null;
		},

		async listMailboxRows(userId, query) {
			const { where, bindings } = buildScope(userId, query);
			const pageSize = query.pageSize ?? MAILBOX_PAGE_SIZE;
			const display = displayFilter(query.view, 'm');

			const totalRow = await db
				.prepare(
					`SELECT COUNT(*) AS count FROM (
						SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_id FROM emails e WHERE ${where}
					)`
				)
				.bind(...bindings)
				.first<{ count: number }>();

			const total = totalRow?.count ?? 0;
			const pageCount = Math.max(1, Math.ceil(total / pageSize));
			const page = Math.min(Math.max(1, query.page ?? 1), pageCount);

			if (total === 0) {
				return { threads: [], total, page, pageCount, pageSize };
			}

			const { results: rows } = await db
				.prepare(
					`SELECT t.thread_id, MAX(datetime(m.created_at)) AS last_at
					 FROM (
						SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_id FROM emails e WHERE ${where}
					 ) t
					 JOIN emails m
					   ON m.user_id = ? AND COALESCE(m.thread_id, m.id) = t.thread_id AND ${display}
					 GROUP BY t.thread_id
					 ORDER BY last_at DESC
					 LIMIT ? OFFSET ?`
				)
				.bind(...bindings, userId, pageSize, (page - 1) * pageSize)
				.all<{ thread_id: string; last_at: string }>();

			const threadIds = rows.map((row) => row.thread_id);
			if (threadIds.length === 0) {
				return { threads: [], total, page, pageCount, pageSize };
			}

			const placeholders = threadIds.map(() => '?').join(', ');
			const { results: messages } = await db
				.prepare(
					`SELECT m.id, COALESCE(m.thread_id, m.id) AS thread_id, m.direction, m.from_addr, m.from_name, m.to_addr,
					        m.subject, m.is_read, m.is_starred, m.archived_at, m.created_at, m.domain_id, m.address_id, m.status,
					        substr(COALESCE(m.body_text, ''), 1, 4000) AS body_head,
					        EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = m.id) AS has_attachments
					 FROM emails m
					 WHERE m.user_id = ? AND COALESCE(m.thread_id, m.id) IN (${placeholders}) AND ${display}
					 ORDER BY datetime(m.created_at) ASC`
				)
				.bind(userId, ...threadIds)
				.all<ThreadMessageRow>();

			const byThread = new Map<string, ThreadMessageRow[]>();
			for (const message of messages) {
				const bucket = byThread.get(message.thread_id);
				if (bucket) bucket.push(message);
				else byThread.set(message.thread_id, [message]);
			}

			const threads = threadIds
				.map((threadId) => byThread.get(threadId))
				.filter((group): group is ThreadMessageRow[] => Boolean(group?.length));

			return { threads, total, page, pageCount, pageSize };
		},

		async listFlatRows(userId, options) {
			const view: MailboxView = options.direction === 'outbound' ? 'sent' : 'inbox';
			const { where, bindings } = buildScope(userId, { view, domainId: options.domainId });

			const { results } = await db
				.prepare(
					`SELECT e.id, e.direction, e.from_addr, e.to_addr, e.subject, e.is_read, e.is_starred, e.archived_at,
					        e.created_at, e.domain_id, e.address_id, e.status,
					        substr(COALESCE(e.body_text, ''), 1, 4000) AS body_head,
					        EXISTS(SELECT 1 FROM email_attachments a WHERE a.email_id = e.id) AS has_attachments
					 FROM emails e
					 WHERE ${where}
					 ORDER BY datetime(e.created_at) DESC
					 LIMIT ?`
				)
				.bind(...bindings, options.limit ?? 100)
				.all<ThreadMessageRow>();

			return results;
		},

		async getCursorCounts(userId, domainId) {
			const bindings: unknown[] = [userId];
			let scope = 'user_id = ?';
			if (domainId) {
				scope += ' AND domain_id = ?';
				bindings.push(domainId);
			}

			const row = await db
				.prepare(
					`SELECT COUNT(*) AS message_count, COALESCE(MAX(rowid), 0) AS latest_rowid
					 FROM emails WHERE ${scope}`
				)
				.bind(...bindings)
				.first<{ message_count: number | string | null; latest_rowid: number | string | null }>();

			return {
				messageCount: Number(row?.message_count ?? 0),
				latestRowid: Number(row?.latest_rowid ?? 0)
			};
		},

		async getMailboxCounts(userId, domainId) {
			const bindings: unknown[] = [userId];
			let scope = 'user_id = ?';
			if (domainId) {
				scope += ' AND domain_id = ?';
				bindings.push(domainId);
			}

			const thread = 'COALESCE(thread_id, id)';

			const row = await db
				.prepare(
					`SELECT
						COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND archived_at IS NULL AND direction = 'inbound' THEN ${thread} END) AS inbox,
						COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND archived_at IS NULL AND direction = 'inbound' AND is_read = 0 THEN ${thread} END) AS inbox_unread,
						COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND archived_at IS NOT NULL AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS archive,
						COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND is_starred = 1 AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS starred,
						COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND status = 'draft' THEN ${thread} END) AS drafts,
						COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND direction = 'outbound' AND (status IS NULL OR status <> 'draft') THEN ${thread} END) AS sent,
						COUNT(DISTINCT CASE WHEN deleted_at IS NOT NULL THEN ${thread} END) AS trash
					 FROM emails WHERE ${scope}`
				)
				.bind(...bindings)
				.first<Record<keyof MailboxCounts, number | null>>();

			return {
				inbox: row?.inbox ?? 0,
				inbox_unread: row?.inbox_unread ?? 0,
				archive: row?.archive ?? 0,
				starred: row?.starred ?? 0,
				drafts: row?.drafts ?? 0,
				sent: row?.sent ?? 0,
				trash: row?.trash ?? 0
			};
		},

		async expandToThreads(userId, ids) {
			if (ids.length === 0) return [];

			const placeholders = ids.map(() => '?').join(', ');
			const { results } = await db
				.prepare(
					`SELECT id FROM emails
					 WHERE user_id = ?
					 AND COALESCE(thread_id, id) IN (
						SELECT COALESCE(thread_id, id) FROM emails WHERE user_id = ? AND id IN (${placeholders})
					 )`
				)
				.bind(userId, userId, ...ids)
				.all<{ id: string }>();

			return results.map((row) => row.id);
		},

		async setFlags(userId, ids, update) {
			if (ids.length === 0) return 0;

			const assignments: string[] = [];
			const bindings: unknown[] = [];

			if (update.isRead !== undefined) {
				assignments.push('is_read = ?');
				bindings.push(update.isRead ? 1 : 0);
			}
			if (update.isStarred !== undefined) {
				assignments.push('is_starred = ?');
				bindings.push(update.isStarred ? 1 : 0);
			}
			if (update.trashed !== undefined) {
				assignments.push(update.trashed ? "deleted_at = datetime('now')" : 'deleted_at = NULL');
			}
			if (update.archived !== undefined) {
				assignments.push(update.archived ? "archived_at = datetime('now')" : 'archived_at = NULL');
			}

			if (assignments.length === 0) return 0;

			const placeholders = ids.map(() => '?').join(', ');
			const result = await db
				.prepare(
					`UPDATE emails SET ${assignments.join(', ')}
					 WHERE user_id = ? AND id IN (${placeholders})`
				)
				.bind(...bindings, userId, ...ids)
				.run();

			return result.meta?.changes ?? 0;
		},

		async findOwnedIds(userId, ids) {
			if (ids.length === 0) return [];
			const placeholders = ids.map(() => '?').join(', ');
			const { results } = await db
				.prepare(`SELECT id FROM emails WHERE user_id = ? AND id IN (${placeholders})`)
				.bind(userId, ...ids)
				.all<{ id: string }>();
			return results.map((row) => row.id);
		},

		async findAttachmentStorageKeys(emailIds) {
			if (emailIds.length === 0) return [];
			const placeholders = emailIds.map(() => '?').join(', ');
			const { results } = await db
				.prepare(
					`SELECT storage_key FROM email_attachments
					 WHERE email_id IN (${placeholders}) AND storage_key IS NOT NULL`
				)
				.bind(...emailIds)
				.all<{ storage_key: string }>();
			return results.map((row) => row.storage_key);
		},

		async deleteAttachmentRows(emailIds) {
			if (emailIds.length === 0) return;
			const placeholders = emailIds.map(() => '?').join(', ');
			await db
				.prepare(`DELETE FROM email_attachments WHERE email_id IN (${placeholders})`)
				.bind(...emailIds)
				.run();
		},

		async deleteEmailRows(userId, emailIds) {
			if (emailIds.length === 0) return;
			const placeholders = emailIds.map(() => '?').join(', ');
			await db
				.prepare(`DELETE FROM emails WHERE user_id = ? AND id IN (${placeholders})`)
				.bind(userId, ...emailIds)
				.run();
		},

		async deleteBlob(bucket, storageKey) {
			await bucket.delete(storageKey);
		},

		async markAllRead(userId, domainId) {
			const bindings: unknown[] = [userId];
			let scope = "user_id = ? AND direction = 'inbound' AND deleted_at IS NULL AND is_read = 0";
			if (domainId) {
				scope += ' AND domain_id = ?';
				bindings.push(domainId);
			}

			const result = await db
				.prepare(`UPDATE emails SET is_read = 1 WHERE ${scope}`)
				.bind(...bindings)
				.run();

			return result.meta?.changes ?? 0;
		},

		async findTrashedIds(userId) {
			const { results } = await db
				.prepare('SELECT id FROM emails WHERE user_id = ? AND deleted_at IS NOT NULL')
				.bind(userId)
				.all<{ id: string }>();
			return results.map((row) => row.id);
		},

		async findDraftForUpdate(id, userId) {
			const row = await db
				.prepare("SELECT id FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
				.bind(id, userId)
				.first<{ id: string }>();
			return row ?? null;
		},

		async updateDraftRow(id, userId, patch) {
			await db
				.prepare(
					`UPDATE emails SET from_addr = ?, to_addr = ?, cc_addr = ?, bcc_addr = ?,
					        subject = ?, thread_key = ?, body_text = ?, body_html = ?,
					        domain_id = ?, address_id = ?,
					        created_at = datetime('now'), deleted_at = NULL
					 WHERE id = ? AND user_id = ?`
				)
				.bind(
					patch.from,
					patch.to,
					patch.cc,
					patch.bcc,
					patch.subject,
					patch.threadKey,
					patch.bodyText,
					patch.bodyHtml,
					patch.domainId,
					patch.addressId,
					id,
					userId
				)
				.run();
		},

		async getDraftRow(userId, draftId) {
			const row = await db
				.prepare("SELECT * FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
				.bind(draftId, userId)
				.first<EmailRow>();
			return row ?? null;
		},

		async deleteDraftRow(userId, draftId) {
			await db
				.prepare("DELETE FROM emails WHERE id = ? AND user_id = ? AND status = 'draft'")
				.bind(draftId, userId)
				.run();
		},

		async listForwardThreadMessages(userId, threadId) {
			const { results } = await db
				.prepare(
					`SELECT * FROM emails
					 WHERE user_id = ?
					   AND COALESCE(thread_id, id) = ?
					   AND (status IS NULL OR status <> 'draft')
					   AND deleted_at IS NULL
					 ORDER BY datetime(created_at) ASC, id ASC`
				)
				.bind(userId, threadId)
				.all<EmailRow>();

			return results;
		},

		async listThreadMessages(userId, threadId, includeDeleted) {
			const scope = includeDeleted ? '' : 'AND e.deleted_at IS NULL';

			type Row = Omit<ThreadMessage, 'attachments' | 'is_read' | 'is_starred'> & {
				is_read: number;
				is_starred: number;
			};

			const { results } = await db
				.prepare(
					`SELECT e.id, e.direction, e.from_addr, e.from_name, e.to_addr, e.cc_addr, e.subject,
					        e.body_text, e.body_html, e.message_id, e.references_header,
					        e.status, e.status_detail, e.scheduled_at, e.is_read, e.is_starred, e.archived_at,
				        e.deleted_at, e.created_at
					 FROM emails e
					 WHERE e.user_id = ?
					 AND COALESCE(e.thread_id, e.id) = ?
					 AND (e.status IS NULL OR e.status <> 'draft')
					 ${scope}
					 ORDER BY datetime(e.created_at) ASC`
				)
				.bind(userId, threadId)
				.all<Row>();

			if (results.length === 0) return [];

			const placeholders = results.map(() => '?').join(', ');
			const { results: files } = await db
				.prepare(
					`SELECT id, email_id, filename, content_type, size_bytes, created_at, content_id
					 FROM email_attachments
					 WHERE email_id IN (${placeholders})
					 ORDER BY created_at ASC`
				)
				.bind(...results.map((message) => message.id))
				.all<EmailAttachmentMeta>();

			return results.map((message) => ({
				...message,
				is_read: message.is_read === 1,
				is_starred: message.is_starred === 1,
				attachments: files.filter((file) => file.email_id === message.id)
			}));
		},

		async markThreadRead(userId, threadId) {
			const result = await db
				.prepare(
					`UPDATE emails SET is_read = 1
					 WHERE user_id = ? AND COALESCE(thread_id, id) = ? AND deleted_at IS NULL
					   AND is_read = 0`
				)
				.bind(userId, threadId)
				.run();

			return result.meta.changes ?? 0;
		}
	};
}
