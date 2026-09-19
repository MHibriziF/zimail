import type { MailCategory } from '../../mail/categories';
import { classifyMail, type ClassifyInput } from './classify';
import type { CategoriesRepository } from './repository';

export type CategoriesService = {
	/** The tab for a new inbound message: a sender the user sorted before wins over the rules. */
	categorizeInbound(userId: string, input: ClassifyInput): Promise<MailCategory>;
	/** Moves the conversations of `emailIds` to a tab and remembers their senders. */
	moveToCategory(userId: string, emailIds: string[], category: MailCategory): Promise<number>;
	tabsEnabled(userId: string): Promise<boolean>;
	setTabsEnabled(userId: string, enabled: boolean): Promise<void>;
	/**
	 * Sorts up to `limit` conversations that arrived before tabs existed, from
	 * sender and subject only — their headers weren't stored. Call repeatedly
	 * until `remaining` is 0.
	 */
	backfill(userId: string, limit?: number): Promise<{ sorted: number; remaining: number }>;
};

export type CategoriesServiceDeps = {
	repo: CategoriesRepository;
	expandToThreads: (userId: string, ids: string[]) => Promise<string[]>;
	setCategory: (userId: string, ids: string[], category: MailCategory) => Promise<number>;
	/** The user's own addresses, never remembered as a sorted sender. */
	ownAddresses: (userId: string) => Promise<string[]>;
};

const BACKFILL_BATCH = 200;

export function createCategoriesService(deps: CategoriesServiceDeps): CategoriesService {
	const { repo, expandToThreads, setCategory, ownAddresses } = deps;

	async function categorizeInbound(userId: string, input: ClassifyInput): Promise<MailCategory> {
		return (await repo.senderCategory(userId, input.from.trim().toLowerCase())) ?? classifyMail(input);
	}

	return {
		categorizeInbound,

		async moveToCategory(userId, emailIds, category) {
			const ids = await expandToThreads(userId, emailIds);
			if (ids.length === 0) return 0;

			const changed = await setCategory(userId, ids, category);
			const own = new Set((await ownAddresses(userId)).map((address) => address.toLowerCase()));
			const senders = (await repo.inboundSenders(userId, ids)).filter((address) => !own.has(address));
			await repo.rememberSender(userId, senders, category);
			return changed;
		},

		tabsEnabled: (userId) => repo.tabsEnabled(userId),
		setTabsEnabled: (userId, enabled) => repo.setTabsEnabled(userId, enabled),

		async backfill(userId, limit = BACKFILL_BATCH) {
			const pending = await repo.uncategorized(userId, limit);
			for (const message of pending) {
				const category =
					message.existingCategory ??
					(await categorizeInbound(userId, { from: message.from, subject: message.subject, headers: {} }));
				const ids = await expandToThreads(userId, [message.id]);
				await setCategory(userId, ids, category);
			}
			return { sorted: pending.length, remaining: await repo.countUncategorized(userId) };
		}
	};
}
