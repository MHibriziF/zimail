import { getMailStoreService } from '../mail-store';
import { createD1LabelsRepository } from './repository';
import { createLabelsService, type LabelsService } from './service';

export type { LabelsRepository } from './repository';
export { createD1LabelsRepository } from './repository';
export { createLabelsService, type LabelsService, type LabelWriteOutcome } from './service';

type PlatformLike = App.Platform | undefined | null;

/** Composition root for routes — mirrors `getMeetingsService`. */
export function getLabelsService(platform: PlatformLike): LabelsService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	const mailStore = getMailStoreService(platform);
	return createLabelsService({
		repo: createD1LabelsRepository(db),
		async conversationOf(userId, emailId) {
			const email = await mailStore.getEmailForUser(userId, emailId);
			return email ? (email.thread_id ?? email.id) : null;
		}
	});
}
