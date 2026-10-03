import type { MailCategory } from '../../mail/categories';
import type { TabMessage, TabsOutcome } from '../ai/tabs';
import { plainBody } from '../util/html';
import { classifyMail, type ClassifyInput } from './classify';
import type { CategoriesRepository, ResortCandidate } from './repository';

export type InboundTabInput = ClassifyInput & {
	fromName?: string | null;
	/** Plain text of the body. Only the model reads it. */
	body?: string | null;
	/** Carries In-Reply-To or References, so it most likely joins a conversation that keeps its own tab. */
	reply?: boolean;
	/** Filed as spam, where no tab shows it. */
	spam?: boolean;
};

export type ResortOutcome =
	| { kind: 'sorted'; sorted: number; moved: number }
	| { kind: 'disabled' }
	| { kind: 'unavailable' }
	| { kind: 'limit_reached' }
	| { kind: 'failed' };

export type CategoriesService = {
	/**
	 * The tab for a new inbound message: a sender the user sorted before wins,
	 * then Clef while tabs are on, then the rules when Clef can't answer.
	 */
	categorizeInbound(userId: string, input: InboundTabInput): Promise<MailCategory>;
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
	/** Re-sorts the newest inbox conversations with Clef. One capped batch per call, started by the user. */
	resortWithAi(userId: string, limit?: number): Promise<ResortOutcome>;
};

export type CategoriesServiceDeps = {
	repo: CategoriesRepository;
	expandToThreads: (userId: string, ids: string[]) => Promise<string[]>;
	setCategory: (userId: string, ids: string[], category: MailCategory) => Promise<number>;
	/** The user's own addresses, never remembered as a sorted sender. */
	ownAddresses: (userId: string) => Promise<string[]>;
	/** Clef on Workers AI; absent when the deploy has no AI binding. */
	sortTabs?: ((messages: TabMessage[]) => Promise<TabsOutcome>) | null;
};

const BACKFILL_BATCH = 200;
/** Two Clef calls, about 300–400 neurons per click at today's message sizes. */
const RESORT_BATCH = 50;

function resortMessage(candidate: ResortCandidate): TabMessage {
	return {
		from: candidate.from,
		fromName: candidate.fromName,
		subject: candidate.subject,
		body: plainBody(candidate.bodyText, candidate.bodyHtml)
	};
}

/** Only a message that can start a conversation in a visible tab is worth a model call. */
function worthAsking(input: InboundTabInput): boolean {
	return !input.calendar && !input.reply && !input.spam;
}

export function createCategoriesService(deps: CategoriesServiceDeps): CategoriesService {
	const { repo, expandToThreads, setCategory, ownAddresses, sortTabs } = deps;

	async function remembered(userId: string, from: string): Promise<MailCategory | null> {
		return repo.senderCategory(userId, from.trim().toLowerCase());
	}

	async function categorizeInbound(userId: string, input: InboundTabInput): Promise<MailCategory> {
		const known = await remembered(userId, input.from);
		if (known) return known;
		if (!sortTabs || !worthAsking(input) || !(await repo.tabsEnabled(userId))) return classifyMail(input);

		const outcome = await sortTabs([input]);
		return (outcome.kind === 'sorted' && outcome.tabs[0]) || classifyMail(input);
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
					(await remembered(userId, message.from)) ??
					classifyMail({ from: message.from, subject: message.subject, headers: {} });
				const ids = await expandToThreads(userId, [message.id]);
				await setCategory(userId, ids, category);
			}
			return { sorted: pending.length, remaining: await repo.countUncategorized(userId) };
		},

		async resortWithAi(userId, limit = RESORT_BATCH) {
			if (!sortTabs) return { kind: 'unavailable' };
			if (!(await repo.tabsEnabled(userId))) return { kind: 'disabled' };

			const candidates = await repo.resortCandidates(userId, limit);
			const outcome = await sortTabs(candidates.map(resortMessage));
			if (outcome.kind !== 'sorted') return outcome;

			// Writes scale with what moved, not with what was read.
			let moved = 0;
			for (const [index, candidate] of candidates.entries()) {
				const tab = outcome.tabs[index];
				if (!tab || tab === (candidate.category ?? 'primary')) continue;
				await setCategory(userId, await expandToThreads(userId, [candidate.id]), tab);
				moved++;
			}
			return { kind: 'sorted', sorted: candidates.length, moved };
		}
	};
}
