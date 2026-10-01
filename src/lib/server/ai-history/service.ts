import type { FoundEvent, FoundMessage, HistoryTurn } from '../ai';
import type { AiHistoryRepository, ConversationSummary } from './repository';

/** Enough to come back to recent questions; older ones are dropped as new ones start. */
export const MAX_CONVERSATIONS = 50;
/** Twenty questions and answers. The model only ever sees the last few of them. */
export const MAX_TURNS = 40;
const TITLE_CHARS = 80;

export type StoredTurn = {
	role: 'user' | 'assistant';
	content: string;
	messages?: FoundMessage[];
	events?: FoundEvent[];
};

export type Conversation = { id: string; title: string; updatedAt: string; turns: StoredTurn[] };

export type AiHistoryService = {
	list(userId: string): Promise<ConversationSummary[]>;
	get(userId: string, id: string): Promise<Conversation | null>;
	/**
	 * Adds a question and its answer, starting a new conversation when `conversation` is null.
	 * Returns the conversation's id.
	 */
	append(
		userId: string,
		conversation: Conversation | null,
		question: string,
		answer: { content: string; messages: FoundMessage[]; events: FoundEvent[] }
	): Promise<string>;
	remove(userId: string, id: string): Promise<boolean>;
};

function isTurn(value: unknown): value is StoredTurn {
	const turn = value as StoredTurn | null;
	return (turn?.role === 'user' || turn?.role === 'assistant') && typeof turn.content === 'string';
}

/** A damaged row reads as an empty conversation rather than failing the page. */
export function parseTurns(json: string): StoredTurn[] {
	try {
		const parsed: unknown = JSON.parse(json);
		return Array.isArray(parsed) ? parsed.filter(isTurn) : [];
	} catch {
		return [];
	}
}

/** The first question, on one line and cut short, names the conversation: no model call needed. */
export function titleFor(question: string): string {
	const line = question.replaceAll(/\s+/g, ' ').trim();
	return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

/** What the model is shown of a stored conversation: words only, no cards. */
export function toHistory(turns: StoredTurn[]): HistoryTurn[] {
	return turns.map(({ role, content }) => ({ role, content }));
}

export function createAiHistoryService(deps: { repo: AiHistoryRepository; newId?: () => string }): AiHistoryService {
	const { repo } = deps;
	const newId = deps.newId ?? (() => crypto.randomUUID());

	return {
		list: (userId) => repo.list(userId, MAX_CONVERSATIONS),

		async get(userId, id) {
			const row = await repo.get(userId, id);
			return row ? { id: row.id, title: row.title, updatedAt: row.updatedAt, turns: parseTurns(row.turns) } : null;
		},

		async append(userId, conversation, question, answer) {
			const added: StoredTurn[] = [
				{ role: 'user', content: question },
				{ role: 'assistant', content: answer.content, messages: answer.messages, events: answer.events }
			];
			if (conversation) {
				const turns = [...conversation.turns, ...added].slice(-MAX_TURNS);
				if (await repo.updateTurns(userId, conversation.id, JSON.stringify(turns))) return conversation.id;
			}
			// New, or deleted from another tab since it was opened: either way, start one.
			const id = newId();
			await repo.insert({ id, userId, title: titleFor(question), turns: JSON.stringify(added) });
			await repo.trim(userId, MAX_CONVERSATIONS);
			return id;
		},

		remove: (userId, id) => repo.delete(userId, id)
	};
}
