/**
 * Rate limits for "ask the host to share my screen".
 *
 * Under the *only people I allow* policy a decline resets the requester's
 * button, so nothing stopped someone pressing it again straight away and
 * ringing the host's chime every time. Two independent limits, because the
 * first is only a courtesy and the second has to hold against a modified
 * client:
 *
 * - the requester waits out a cooldown after being declined, and
 * - the host's chime stays silent for repeat requests from the same identity.
 *
 * The host still *sees* a repeat request in the list. Dropping it outright
 * would let a mistimed second press be swallowed silently.
 */

/** How long a declined participant waits before the share button works again. */
export const SHARE_REQUEST_COOLDOWN_MS = 30_000;

/** How long the host's chime ignores further requests from the same identity. */
export const SHARE_REQUEST_CHIME_WINDOW_MS = 60_000;

/** Milliseconds left on the cooldown, or 0 when there is none. */
export function cooldownRemainingMs(declinedAt: number | null, now: number, windowMs = SHARE_REQUEST_COOLDOWN_MS): number {
	if (declinedAt === null) return 0;
	// A clock that jumped backwards would otherwise strand the button for hours.
	if (now < declinedAt) return windowMs;
	return Math.max(0, declinedAt + windowMs - now);
}

/** Whole seconds left, for the button's countdown label. */
export function cooldownSecondsLeft(declinedAt: number | null, now: number, windowMs = SHARE_REQUEST_COOLDOWN_MS): number {
	return Math.ceil(cooldownRemainingMs(declinedAt, now, windowMs) / 1000);
}

export type RequestChimeGate = {
	/** True the first time an identity asks, then false again until the window passes. */
	shouldRing(identity: string, now: number): boolean;
	/** Drop an identity's history — call it when they leave, so the map stays call-sized. */
	forget(identity: string): void;
};

export function createRequestChimeGate(windowMs = SHARE_REQUEST_CHIME_WINDOW_MS): RequestChimeGate {
	const lastRing = new Map<string, number>();
	return {
		shouldRing(identity, now) {
			const previous = lastRing.get(identity);
			if (previous !== undefined && now >= previous && now - previous < windowMs) return false;
			lastRing.set(identity, now);
			return true;
		},
		forget(identity) {
			lastRing.delete(identity);
		}
	};
}
