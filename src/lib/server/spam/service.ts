import type { MailFlagUpdate } from '../mail-store/repository';
import { authenticationFailed } from './authentication';
import type { SpamRepository } from './repository';

export type SpamService = {
	/**
	 * Moves the conversations of `emailIds` into Spam (or back out), and
	 * remembers (or forgets) their senders so their next mail is filed the same
	 * way. Returns how many messages changed.
	 */
	setSpam(userId: string, emailIds: string[], spam: boolean): Promise<number>;
	/** The inbound verdict: a blocked sender, or authentication the receiving server saw fail. */
	isSpamInbound(
		userId: string,
		from: string,
		authenticationResults: (string | null | undefined)[]
	): Promise<boolean>;
};

export type SpamServiceDeps = {
	repo: SpamRepository;
	/** Owner-scoped: every message id in the conversations of `ids`. */
	expandToThreads: (userId: string, ids: string[]) => Promise<string[]>;
	setEmailFlags: (userId: string, ids: string[], update: MailFlagUpdate) => Promise<number>;
	/** The user's own addresses, which are never blocked — mail to yourself isn't spam. */
	ownAddresses: (userId: string) => Promise<string[]>;
};

export function createSpamService({ repo, expandToThreads, setEmailFlags, ownAddresses }: SpamServiceDeps): SpamService {
	return {
		async setSpam(userId, emailIds, spam) {
			const ids = await expandToThreads(userId, emailIds);
			if (ids.length === 0) return 0;

			const changed = await setEmailFlags(userId, ids, { spam });
			const own = new Set((await ownAddresses(userId)).map((address) => address.toLowerCase()));
			const senders = (await repo.inboundSenders(userId, ids)).filter((address) => !own.has(address));

			if (spam) await repo.block(userId, senders);
			else await repo.unblock(userId, senders);
			return changed;
		},

		async isSpamInbound(userId, from, authenticationResults) {
			if (authenticationFailed(...authenticationResults)) return true;
			return repo.isBlocked(userId, from.trim().toLowerCase());
		}
	};
}
