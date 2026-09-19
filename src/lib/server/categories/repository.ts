import type { D1Database } from '@cloudflare/workers-types';
import { MAIL_CATEGORIES, type MailCategory } from '../../mail/categories';

export type UncategorizedMessage = {
	id: string;
	from: string;
	subject: string;
	conversationId: string;
	/** A tab some other message of the conversation already has — kept, so it stays in one tab. */
	existingCategory: MailCategory | null;
};

export type CategoriesRepository = {
	senderCategory(userId: string, address: string): Promise<MailCategory | null>;
	rememberSender(userId: string, addresses: string[], category: MailCategory): Promise<void>;
	inboundSenders(userId: string, emailIds: string[]): Promise<string[]>;
	tabsEnabled(userId: string): Promise<boolean>;
	setTabsEnabled(userId: string, enabled: boolean): Promise<void>;
	/** The oldest still-unsorted inbound message of each conversation that has one. */
	uncategorized(userId: string, limit: number): Promise<UncategorizedMessage[]>;
	countUncategorized(userId: string): Promise<number>;
};

export function createD1CategoriesRepository(db: D1Database): CategoriesRepository {
	return {
		async senderCategory(userId, address) {
			const row = await db
				.prepare('SELECT category FROM sender_categories WHERE user_id = ? AND address = ?')
				.bind(userId, address)
				.first<{ category: string }>();
			return MAIL_CATEGORIES.find((category) => category === row?.category) ?? null;
		},

		async rememberSender(userId, addresses, category) {
			if (addresses.length === 0) return;
			await db.batch(
				addresses.map((address) =>
					db
						.prepare(
							`INSERT INTO sender_categories (user_id, address, category) VALUES (?, ?, ?)
							 ON CONFLICT (user_id, address) DO UPDATE SET category = excluded.category`
						)
						.bind(userId, address, category)
				)
			);
		},

		async inboundSenders(userId, emailIds) {
			if (emailIds.length === 0) return [];
			const placeholders = emailIds.map(() => '?').join(', ');
			const { results } = await db
				.prepare(
					`SELECT DISTINCT lower(from_addr) AS address FROM emails
					 WHERE user_id = ? AND direction = 'inbound' AND id IN (${placeholders})`
				)
				.bind(userId, ...emailIds)
				.all<{ address: string }>();
			return results.map((row) => row.address).filter(Boolean);
		},

		async tabsEnabled(userId) {
			const row = await db
				.prepare('SELECT inbox_tabs FROM users WHERE id = ?')
				.bind(userId)
				.first<{ inbox_tabs: number }>();
			return row?.inbox_tabs !== 0;
		},

		async setTabsEnabled(userId, enabled) {
			await db.prepare('UPDATE users SET inbox_tabs = ? WHERE id = ?').bind(enabled ? 1 : 0, userId).run();
		},

		async uncategorized(userId, limit) {
			const { results } = await db
				.prepare(
					`SELECT e.id, e.from_addr, e.subject, COALESCE(e.thread_id, e.id) AS conversation_id,
					        (SELECT MAX(sorted.category) FROM emails sorted
					         WHERE sorted.user_id = e.user_id
					           AND COALESCE(sorted.thread_id, sorted.id) = COALESCE(e.thread_id, e.id)) AS existing_category
					 FROM emails e
					 WHERE e.user_id = ? AND e.direction = 'inbound' AND e.category IS NULL
					   AND NOT EXISTS (
					     SELECT 1 FROM emails older
					     WHERE older.user_id = e.user_id AND older.direction = 'inbound' AND older.category IS NULL
					       AND COALESCE(older.thread_id, older.id) = COALESCE(e.thread_id, e.id)
					       AND datetime(older.created_at) < datetime(e.created_at)
					   )
					 LIMIT ?`
				)
				.bind(userId, limit)
				.all<{ id: string; from_addr: string; subject: string; conversation_id: string; existing_category: string | null }>();
			return results.map((row) => ({
				id: row.id,
				from: row.from_addr,
				subject: row.subject,
				conversationId: row.conversation_id,
				existingCategory: MAIL_CATEGORIES.find((category) => category === row.existing_category) ?? null
			}));
		},

		async countUncategorized(userId) {
			const row = await db
				.prepare(
					`SELECT COUNT(DISTINCT COALESCE(thread_id, id)) AS count FROM emails
					 WHERE user_id = ? AND direction = 'inbound' AND category IS NULL`
				)
				.bind(userId)
				.first<{ count: number }>();
			return row?.count ?? 0;
		}
	};
}
