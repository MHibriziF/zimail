import type { D1Database } from '@cloudflare/workers-types';
import { LABEL_COLORS, type Label, type LabelColor } from '../../mail/labels';

type LabelRow = { id: string; name: string; color: string };

function toLabel(row: LabelRow): Label {
	const color = LABEL_COLORS.find((entry) => entry === row.color) ?? 'gray';
	return { id: row.id, name: row.name, color };
}

/**
 * Raw D1 access for labels. No name/color validation, no ownership reasoning
 * beyond scoping every query by `user_id` — see `./service.ts` for the rules.
 * `insert`/`update` let a unique-constraint violation on the name propagate as
 * D1 throws it, for the service to turn into a "that name is taken" answer.
 */
export type LabelsRepository = {
	listForUser(userId: string): Promise<Label[]>;
	countForUser(userId: string): Promise<number>;
	insert(label: { id: string; userId: string; name: string; color: LabelColor }): Promise<void>;
	update(userId: string, id: string, patch: { name?: string; color?: LabelColor }): Promise<boolean>;
	delete(userId: string, id: string): Promise<boolean>;
	/** Only the ids among `ids` that exist and belong to the user. */
	ownedIds(userId: string, ids: string[]): Promise<string[]>;
	/** Replaces a conversation's labels wholesale. */
	setForConversation(userId: string, conversationId: string, labelIds: string[]): Promise<void>;
	listForConversations(userId: string, conversationIds: string[]): Promise<Map<string, Label[]>>;
};

export function createD1LabelsRepository(db: D1Database): LabelsRepository {
	return {
		async listForUser(userId) {
			const { results } = await db
				.prepare('SELECT id, name, color FROM labels WHERE user_id = ? ORDER BY name COLLATE NOCASE')
				.bind(userId)
				.all<LabelRow>();
			return results.map(toLabel);
		},

		async countForUser(userId) {
			const row = await db
				.prepare('SELECT COUNT(*) AS count FROM labels WHERE user_id = ?')
				.bind(userId)
				.first<{ count: number }>();
			return row?.count ?? 0;
		},

		async insert(label) {
			await db
				.prepare('INSERT INTO labels (id, user_id, name, color) VALUES (?, ?, ?, ?)')
				.bind(label.id, label.userId, label.name, label.color)
				.run();
		},

		async update(userId, id, patch) {
			const sets: string[] = [];
			const values: unknown[] = [];
			if (patch.name !== undefined) {
				sets.push('name = ?');
				values.push(patch.name);
			}
			if (patch.color !== undefined) {
				sets.push('color = ?');
				values.push(patch.color);
			}
			if (sets.length === 0) return false;

			const result = await db
				.prepare(`UPDATE labels SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
				.bind(...values, id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async delete(userId, id) {
			// conversation_labels rows go with it via ON DELETE CASCADE.
			const result = await db
				.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?')
				.bind(id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async ownedIds(userId, ids) {
			if (ids.length === 0) return [];
			const placeholders = ids.map(() => '?').join(', ');
			const { results } = await db
				.prepare(`SELECT id FROM labels WHERE user_id = ? AND id IN (${placeholders})`)
				.bind(userId, ...ids)
				.all<{ id: string }>();
			return results.map((row) => row.id);
		},

		async setForConversation(userId, conversationId, labelIds) {
			await db.batch([
				db
					.prepare('DELETE FROM conversation_labels WHERE user_id = ? AND conversation_id = ?')
					.bind(userId, conversationId),
				...labelIds.map((labelId) =>
					db
						.prepare(
							'INSERT INTO conversation_labels (user_id, conversation_id, label_id) VALUES (?, ?, ?)'
						)
						.bind(userId, conversationId, labelId)
				)
			]);
		},

		async listForConversations(userId, conversationIds) {
			const byConversation = new Map<string, Label[]>();
			if (conversationIds.length === 0) return byConversation;

			const placeholders = conversationIds.map(() => '?').join(', ');
			const { results } = await db
				.prepare(
					`SELECT cl.conversation_id, l.id, l.name, l.color
					 FROM conversation_labels cl
					 JOIN labels l ON l.id = cl.label_id
					 WHERE cl.user_id = ? AND cl.conversation_id IN (${placeholders})
					 ORDER BY l.name COLLATE NOCASE`
				)
				.bind(userId, ...conversationIds)
				.all<LabelRow & { conversation_id: string }>();

			for (const row of results) {
				const list = byConversation.get(row.conversation_id);
				if (list) list.push(toLabel(row));
				else byConversation.set(row.conversation_id, [toLabel(row)]);
			}
			return byConversation;
		}
	};
}
