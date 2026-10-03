/**
 * Emoji reactions ride a text stream and are never stored. Anyone can send
 * anything on a topic, so a received reaction is only shown if it is one of
 * these, and both ends rate-limit: the sender as a courtesy, the receiver
 * per identity so a modified client can't flood the stage either.
 */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉', '🤔', '🙌'] as const;

export type Reaction = (typeof REACTIONS)[number];

export const REACTION_LIMIT = 3;
export const REACTION_WINDOW_MS = 1_000;
export const MAX_REACTIONS_ON_SCREEN = 12;

export function isReaction(value: string): value is Reaction {
	return (REACTIONS as readonly string[]).includes(value);
}

export type ReactionLimiter = {
	/** True while `key` has sent fewer than the limit within the window, counting this one. */
	allow(key: string, now: number): boolean;
	/** Drop a sender's history when they leave, so the map stays call-sized. */
	forget(key: string): void;
};

export function createReactionLimiter(limit = REACTION_LIMIT, windowMs = REACTION_WINDOW_MS): ReactionLimiter {
	const recent = new Map<string, number[]>();
	return {
		allow(key, now) {
			// A clock that jumped backwards drops the "future" entries rather than blocking forever.
			const kept = (recent.get(key) ?? []).filter((at) => now >= at && now - at < windowMs);
			const allowed = kept.length < limit;
			if (allowed) kept.push(now);
			recent.set(key, kept);
			return allowed;
		},
		forget(key) {
			recent.delete(key);
		}
	};
}

/** Appends, dropping the oldest once the stage already holds `max`. */
export function pushCapped<T>(list: T[], item: T, max = MAX_REACTIONS_ON_SCREEN): T[] {
	const next = [...list, item];
	return next.length > max ? next.slice(next.length - max) : next;
}
