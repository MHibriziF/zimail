import {
	MAX_LABELS_PER_USER,
	normalizeLabelName,
	type Label,
	type LabelColor
} from '../../mail/labels';
import type { LabelsRepository } from './repository';

export type LabelWriteOutcome =
	| { type: 'ok'; label: Label }
	| { type: 'invalid_name' }
	| { type: 'duplicate_name' }
	| { type: 'limit_reached' }
	| { type: 'not_found' };

export type LabelsService = {
	list(userId: string): Promise<Label[]>;
	create(userId: string, input: { name: string; color: LabelColor }): Promise<LabelWriteOutcome>;
	update(
		userId: string,
		id: string,
		changes: { name?: string; color?: LabelColor }
	): Promise<LabelWriteOutcome>;
	remove(userId: string, id: string): Promise<boolean>;
	/**
	 * Replaces the labels on the conversation `emailId` belongs to. Label ids the
	 * user doesn't own are dropped rather than rejected. `null` when the message
	 * isn't the user's.
	 */
	setForMessage(userId: string, emailId: string, labelIds: string[]): Promise<Label[] | null>;
	listForConversations(userId: string, conversationIds: string[]): Promise<Map<string, Label[]>>;
};

export type LabelsServiceDeps = {
	repo: LabelsRepository;
	/** The conversation a message belongs to, scoped to its owner — `null` if it isn't theirs. */
	conversationOf: (userId: string, emailId: string) => Promise<string | null>;
};

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique constraint/i.test(error.message);
}

export function createLabelsService({ repo, conversationOf }: LabelsServiceDeps): LabelsService {
	return {
		list: (userId) => repo.listForUser(userId),

		async create(userId, input) {
			const name = normalizeLabelName(input.name);
			if (!name) return { type: 'invalid_name' };
			if ((await repo.countForUser(userId)) >= MAX_LABELS_PER_USER) return { type: 'limit_reached' };

			const label: Label = { id: crypto.randomUUID(), name, color: input.color };
			try {
				await repo.insert({ ...label, userId });
			} catch (error) {
				if (isUniqueConstraintError(error)) return { type: 'duplicate_name' };
				throw error;
			}
			return { type: 'ok', label };
		},

		async update(userId, id, changes) {
			const patch: { name?: string; color?: LabelColor } = {};
			if (changes.name !== undefined) {
				const name = normalizeLabelName(changes.name);
				if (!name) return { type: 'invalid_name' };
				patch.name = name;
			}
			if (changes.color !== undefined) patch.color = changes.color;

			if (Object.keys(patch).length > 0) {
				try {
					if (!(await repo.update(userId, id, patch))) return { type: 'not_found' };
				} catch (error) {
					if (isUniqueConstraintError(error)) return { type: 'duplicate_name' };
					throw error;
				}
			}

			const label = (await repo.listForUser(userId)).find((entry) => entry.id === id);
			return label ? { type: 'ok', label } : { type: 'not_found' };
		},

		remove: (userId, id) => repo.delete(userId, id),

		async setForMessage(userId, emailId, labelIds) {
			const conversationId = await conversationOf(userId, emailId);
			if (!conversationId) return null;

			const owned = await repo.ownedIds(userId, [...new Set(labelIds)]);
			await repo.setForConversation(userId, conversationId, owned);
			return (await repo.listForConversations(userId, [conversationId])).get(conversationId) ?? [];
		},

		listForConversations: (userId, conversationIds) => repo.listForConversations(userId, conversationIds)
	};
}
