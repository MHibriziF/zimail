import { createD1AiHistoryRepository } from './repository';
import { createAiHistoryService, type AiHistoryService } from './service';

export type { AiHistoryRepository, ConversationSummary } from './repository';
export { createD1AiHistoryRepository } from './repository';
export { createAiHistoryService, toHistory, type AiHistoryService, type Conversation, type StoredTurn } from './service';

type PlatformLike = App.Platform | undefined | null;

/** Composition root for routes — mirrors `getLabelsService`. */
export function getAiHistoryService(platform: PlatformLike): AiHistoryService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return createAiHistoryService({ repo: createD1AiHistoryRepository(db) });
}
