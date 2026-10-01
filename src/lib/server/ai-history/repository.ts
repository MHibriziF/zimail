import type { D1Database } from '@cloudflare/workers-types';

export type ConversationSummary = { id: string; title: string; updatedAt: string };
export type ConversationRow = ConversationSummary & { turns: string };

/** Raw D1 access for Ask AI conversations, every query scoped by `user_id`. Rules live in `./service.ts`. */
export type AiHistoryRepository = {
	/** Newest first; never reads the turns, so the list costs only the index. */
	list(userId: string, limit: number): Promise<ConversationSummary[]>;
	get(userId: string, id: string): Promise<ConversationRow | null>;
	insert(row: { id: string; userId: string; title: string; turns: string }): Promise<void>;
	/** False when there's no such conversation for the user. */
	updateTurns(userId: string, id: string, turns: string): Promise<boolean>;
	delete(userId: string, id: string): Promise<boolean>;
	/** Drops all but the newest `keep`; writes nothing while the user is under it. */
	trim(userId: string, keep: number): Promise<void>;
};

type Row = { id: string; title: string; updated_at: string; turns?: string };

export function createD1AiHistoryRepository(db: D1Database): AiHistoryRepository {
	return {
		async list(userId, limit) {
			const { results } = await db
				.prepare('SELECT id, title, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
				.bind(userId, limit)
				.all<Row>();
			return results.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
		},

		async get(userId, id) {
			const row = await db
				.prepare('SELECT id, title, updated_at, turns FROM ai_conversations WHERE id = ? AND user_id = ?')
				.bind(id, userId)
				.first<Row>();
			return row ? { id: row.id, title: row.title, updatedAt: row.updated_at, turns: row.turns ?? '[]' } : null;
		},

		async insert(row) {
			await db
				.prepare('INSERT INTO ai_conversations (id, user_id, title, turns) VALUES (?, ?, ?, ?)')
				.bind(row.id, row.userId, row.title, row.turns)
				.run();
		},

		async updateTurns(userId, id, turns) {
			const result = await db
				.prepare("UPDATE ai_conversations SET turns = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
				.bind(turns, id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async delete(userId, id) {
			const result = await db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').bind(id, userId).run();
			return (result.meta.changes ?? 0) > 0;
		},

		async trim(userId, keep) {
			await db
				.prepare(
					`DELETE FROM ai_conversations WHERE user_id = ? AND id NOT IN (
						SELECT id FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?
					)`
				)
				.bind(userId, userId, keep)
				.run();
		}
	};
}
