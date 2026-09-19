import type { R2Bucket } from '@cloudflare/workers-types';
import { buildThreadParticipants } from './thread-participants';
import { MAX_BODY_BYTES } from '../constants';
import { stripQuotedText } from '$lib/utils/quotes';
import type { Label } from '$lib/mail/labels';
import { displaySubject, normalizeSubject, type ThreadLookup } from './threads';
import type {
	DeliveryStatus,
	EmailRow,
	EmailSummary,
	MailboxCounts,
	MailboxPage,
	MailStatus,
	ThreadMessage,
	ThreadSummary
} from '$lib/types';
import type { MailboxQuery, MailFlagUpdate, MailStoreRepository, ThreadMessageRow } from './repository';

export type InsertEmailInput = {
	userId: string;
	direction: 'inbound' | 'outbound';
	from: string;
	/** Display name the message arrived under, when it had one. */
	fromName?: string | null;
	to: string;
	cc?: string | null;
	bcc?: string | null;
	subject: string;
	bodyText?: string | null;
	bodyHtml?: string | null;
	messageId?: string | null;
	inReplyTo?: string | null;
	references?: string | null;
	replyToEmailId?: string | null;
	domainId?: string | null;
	addressId?: string | null;
	providerId?: string | null;
	status?: MailStatus | null;
	scheduledAt?: string | null;
	isRead?: boolean;
	/** Disable fallback grouping when this message must start a conversation. */
	subjectMatch?: boolean;
};

export type DraftInput = {
	id?: string | null;
	from: string;
	to: string;
	cc?: string | null;
	bcc?: string | null;
	subject: string;
	bodyText?: string | null;
	bodyHtml?: string | null;
	domainId?: string | null;
	addressId?: string | null;
};

function truncate(value: string | null): string | null {
	if (!value) return null;
	if (value.length <= MAX_BODY_BYTES) return value;
	return value.slice(0, MAX_BODY_BYTES);
}

/** The newest message's own words — quoted history is dropped. */
function buildPreview(bodyHead: string | null): string {
	if (!bodyHead) return '';
	return stripQuotedText(bodyHead).replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** `messages` is the whole conversation, oldest first. */
function toThreadSummary(messages: ThreadMessageRow[], labels: Label[] = []): ThreadSummary {
	const oldest = messages[0];
	const latest = messages.at(-1) as ThreadMessageRow;

	// Senders in the order they first spoke, with our own identities collapsed
	// into a single "me" the way a conversation header reads.
	const participants = buildThreadParticipants(messages);

	return {
		thread_id: oldest.thread_id,
		latest_id: latest.id,
		// The conversation keeps the subject it started with, not "Re: Re: …".
		subject: displaySubject(oldest.subject),
		preview: buildPreview(latest.body_head),
		participants,
		message_count: messages.length,
		is_read: messages.every((message) => message.is_read === 1),
		is_starred: messages.some((message) => message.is_starred === 1),
		is_draft: latest.status === 'draft',
		// A conversation is archived only once every message in it is.
		is_archived: messages.every((message) => message.archived_at !== null),
		has_attachments: messages.some((message) => message.has_attachments === 1),
		domain_id: latest.domain_id,
		address_id: latest.address_id,
		status: latest.status === 'draft' ? null : latest.status,
		labels,
		created_at: latest.created_at
	};
}

function toEmailSummary(row: ThreadMessageRow): EmailSummary {
	return {
		id: row.id,
		direction: row.direction,
		from_addr: row.from_addr,
		to_addr: row.to_addr,
		subject: row.subject,
		preview: buildPreview(row.body_head),
		is_read: row.is_read === 1,
		is_starred: row.is_starred === 1,
		is_draft: row.status === 'draft',
		is_archived: row.archived_at !== null,
		has_attachments: row.has_attachments === 1,
		domain_id: row.domain_id,
		address_id: row.address_id,
		status: row.status === 'draft' ? null : row.status,
		created_at: row.created_at
	};
}

/**
 * Cheap "has anything been inserted or deleted?" fingerprint. Flag changes
 * (read, star, archive) do not move this, so a live poll can refresh on new
 * mail without fighting the user's current selection.
 */
export function encodeMailboxCursor(messageCount: number, latestRowid: number): string {
	return `${messageCount}:${latestRowid}`;
}

export type MailStoreService = {
	getUserIdByEmail(email: string): Promise<string | null>;
	insertEmail(input: InsertEmailInput): Promise<string>;
	emailExistsByProviderId(providerId: string): Promise<boolean>;
	updateEmailStatusByProviderId(
		providerId: string,
		status: DeliveryStatus,
		detail?: string | null
	): Promise<void>;
	getEmailForUser(userId: string, emailId: string): Promise<EmailRow | null>;

	listMailbox(userId: string, query: MailboxQuery): Promise<MailboxPage>;
	listEmails(
		userId: string,
		options?: { direction?: 'inbound' | 'outbound'; domainId?: string | null; limit?: number }
	): Promise<EmailSummary[]>;

	getMailboxCursor(userId: string, domainId?: string | null): Promise<string>;
	getMailboxCounts(userId: string, domainId?: string | null): Promise<MailboxCounts>;
	countUnread(userId: string, domainId?: string | null): Promise<number>;

	/** Widens a set of message ids to every message in the same conversations. */
	expandToThreads(userId: string, ids: string[]): Promise<string[]>;
	setEmailFlags(userId: string, ids: string[], update: MailFlagUpdate): Promise<number>;
	/** Irreversible: drops the rows and the R2 objects their attachments point at. */
	deleteEmailsPermanently(userId: string, bucket: R2Bucket | undefined, ids: string[]): Promise<number>;
	markAllRead(userId: string, domainId?: string | null): Promise<number>;
	emptyTrash(userId: string, bucket: R2Bucket | undefined): Promise<number>;

	saveDraft(userId: string, input: DraftInput): Promise<string>;
	getDraft(userId: string, draftId: string): Promise<EmailRow | null>;
	deleteDraft(userId: string, draftId: string): Promise<void>;

	listForwardThreadMessages(userId: string, threadId: string): Promise<EmailRow[]>;
	listThreadMessages(userId: string, email: EmailRow): Promise<ThreadMessage[]>;
	markThreadRead(userId: string, email: EmailRow): Promise<number>;
};

export type MailStoreServiceDeps = {
	repo: MailStoreRepository;
	/**
	 * `resolveThreadId` (threads.ts) isn't part of this pilot — it stays a
	 * `db`-first function with its own D1 queries. Bound to a repo-shaped
	 * function here so the service's own dependency stays testable without a
	 * real/fake D1.
	 */
	resolveThread: (userId: string, input: ThreadLookup) => Promise<string>;
};

export function createMailStoreService(deps: MailStoreServiceDeps): MailStoreService {
	const { repo, resolveThread } = deps;

	async function insertEmail(input: InsertEmailInput): Promise<string> {
		const id = crypto.randomUUID();
		const bodyText = truncate(input.bodyText ?? null);
		const bodyHtml = truncate(input.bodyHtml ?? null);

		// Every message lands in a conversation before it is stored, so the list
		// view never has to guess.
		const threadId = await resolveThread(input.userId, {
			emailId: id,
			direction: input.direction,
			subject: input.subject,
			from: input.from,
			to: input.to,
			cc: input.cc,
			inReplyTo: input.inReplyTo,
			references: input.references,
			replyToEmailId: input.replyToEmailId,
			domainId: input.domainId,
			subjectMatch: input.subjectMatch ?? input.status !== 'draft'
		});

		await repo.insertRow({
			id,
			userId: input.userId,
			direction: input.direction,
			from: input.from,
			fromName: input.fromName ?? null,
			to: input.to,
			cc: input.cc ?? null,
			bcc: input.bcc ?? null,
			subject: input.subject,
			bodyText,
			bodyHtml,
			messageId: input.messageId ?? null,
			inReplyTo: input.inReplyTo ?? null,
			references: input.references ?? null,
			replyToEmailId: input.replyToEmailId ?? null,
			threadId,
			threadKey: normalizeSubject(input.subject),
			domainId: input.domainId ?? null,
			addressId: input.addressId ?? null,
			providerId: input.providerId ?? null,
			status: input.status ?? null,
			scheduledAt: input.scheduledAt ?? null,
			isRead: input.isRead ?? false
		});

		// A new inbound reply brings an archived conversation back to the inbox.
		if (input.direction === 'inbound') {
			await repo.clearArchiveForThread(input.userId, threadId);
		} else if (input.replyToEmailId) {
			// Sending a reply from an archived conversation should not silently move
			// it back into the inbox. Carry the parent's archive state forward.
			await repo.carryArchiveToReply(input.userId, id, input.replyToEmailId);
		}

		return id;
	}

	async function deleteEmailsPermanently(
		userId: string,
		bucket: R2Bucket | undefined,
		ids: string[]
	): Promise<number> {
		if (ids.length === 0) return 0;

		const ownedIds = await repo.findOwnedIds(userId, ids);
		if (ownedIds.length === 0) return 0;

		if (bucket) {
			const keys = await repo.findAttachmentStorageKeys(ownedIds);
			await Promise.all(keys.map((key) => repo.deleteBlob(bucket, key)));
		}

		// Older D1 databases were created without ON DELETE CASCADE enforcement,
		// so clear the children explicitly.
		await repo.deleteAttachmentRows(ownedIds);
		await repo.deleteEmailRows(userId, ownedIds);

		return ownedIds.length;
	}

	return {
		getUserIdByEmail: (email) => repo.getUserIdByEmail(email),
		insertEmail,
		emailExistsByProviderId: (providerId) => repo.existsByProviderId(providerId),
		updateEmailStatusByProviderId: (providerId, status, detail) =>
			repo.updateStatusByProviderId(providerId, status, detail ?? null),
		getEmailForUser: (userId, emailId) => repo.getForUser(userId, emailId),

		async listMailbox(userId, query) {
			const { threads, labels, total, page, pageCount, pageSize } = await repo.listMailboxRows(userId, query);
			return {
				threads: threads.map((messages) => toThreadSummary(messages, labels.get(messages[0].thread_id))),
				total,
				page,
				pageCount,
				pageSize
			};
		},

		async listEmails(userId, options = {}) {
			const rows = await repo.listFlatRows(userId, options);
			return rows.map(toEmailSummary);
		},

		async getMailboxCursor(userId, domainId) {
			const { messageCount, latestRowid } = await repo.getCursorCounts(userId, domainId);
			return encodeMailboxCursor(messageCount, latestRowid);
		},
		getMailboxCounts: (userId, domainId) => repo.getMailboxCounts(userId, domainId),
		async countUnread(userId, domainId) {
			const counts = await repo.getMailboxCounts(userId, domainId);
			return counts.inbox_unread;
		},

		expandToThreads: (userId, ids) => repo.expandToThreads(userId, ids),
		setEmailFlags: (userId, ids, update) => repo.setFlags(userId, ids, update),
		deleteEmailsPermanently,
		markAllRead: (userId, domainId) => repo.markAllRead(userId, domainId),
		async emptyTrash(userId, bucket) {
			const ids = await repo.findTrashedIds(userId);
			return deleteEmailsPermanently(userId, bucket, ids);
		},

		/** Creates or updates a draft; drafts are outbound rows Resend never saw. */
		async saveDraft(userId, input) {
			if (input.id) {
				const existing = await repo.findDraftForUpdate(input.id, userId);
				if (existing) {
					await repo.updateDraftRow(input.id, userId, {
						from: input.from,
						to: input.to,
						cc: input.cc ?? null,
						bcc: input.bcc ?? null,
						subject: input.subject,
						threadKey: normalizeSubject(input.subject),
						bodyText: input.bodyText ?? null,
						bodyHtml: input.bodyHtml ?? null,
						domainId: input.domainId ?? null,
						addressId: input.addressId ?? null
					});
					return input.id;
				}
			}

			return insertEmail({
				userId,
				direction: 'outbound',
				from: input.from,
				to: input.to,
				cc: input.cc ?? null,
				bcc: input.bcc ?? null,
				subject: input.subject,
				bodyText: input.bodyText ?? null,
				bodyHtml: input.bodyHtml ?? null,
				domainId: input.domainId ?? null,
				addressId: input.addressId ?? null,
				status: 'draft',
				isRead: true
			});
		},
		getDraft: (userId, draftId) => repo.getDraftRow(userId, draftId),
		deleteDraft: (userId, draftId) => repo.deleteDraftRow(userId, draftId),

		listForwardThreadMessages: (userId, threadId) => repo.listForwardThreadMessages(userId, threadId),
		listThreadMessages: (userId, email) => {
			// Opening a trashed message shows the trashed conversation; otherwise the
			// live one. Drafts are edited in the composer, never inline.
			const includeDeleted = Boolean(email.deleted_at);
			return repo.listThreadMessages(userId, email.thread_id ?? email.id, includeDeleted);
		},
		/** Opening a conversation clears the unread state on all of its messages. */
		markThreadRead: (userId, email) => repo.markThreadRead(userId, email.thread_id ?? email.id)
	};
}
