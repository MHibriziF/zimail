/**
 * Per-meeting screen-share rules, shared by the server (which enforces the
 * policy through LiveKit publish permissions) and CallStage (which enforces
 * the mode and decides which share gets the big tile).
 */

export const SCREEN_SHARE_POLICIES = ['open', 'approval'] as const;
/** `open`: anyone can share. `approval`: non-hosts must be allowed by the host first. */
export type ScreenSharePolicy = (typeof SCREEN_SHARE_POLICIES)[number];

export const SCREEN_SHARE_MODES = ['single', 'multiple'] as const;
/** `single`: a new share stops the previous one. `multiple`: shares coexist, newest is featured. */
export type ScreenShareMode = (typeof SCREEN_SHARE_MODES)[number];

export type ScreenShareSettings = { policy: ScreenSharePolicy; mode: ScreenShareMode };

export const DEFAULT_SCREEN_SHARE: ScreenShareSettings = { policy: 'open', mode: 'multiple' };

export function parseScreenSharePolicy(value: unknown): ScreenSharePolicy | undefined {
	return SCREEN_SHARE_POLICIES.find((policy) => policy === value);
}

export function parseScreenShareMode(value: unknown): ScreenShareMode | undefined {
	return SCREEN_SHARE_MODES.find((mode) => mode === value);
}

/**
 * Which share gets the large tile. `order` lists active shares oldest first.
 * A share the viewer clicked wins while it lasts; otherwise the newest share
 * from someone else, since your own screen shown back at you large is just a
 * mirror — yours is only featured when it's the only one.
 */
export function pickFeaturedShare(order: readonly string[], pinned: string | null, localKey: string): string | null {
	if (pinned && order.includes(pinned)) return pinned;
	for (let i = order.length - 1; i >= 0; i--) {
		if (order[i] !== localKey) return order[i];
	}
	return order.includes(localKey) ? localKey : null;
}

/** Two shares starting this close together are treated as simultaneous. */
export const SIMULTANEOUS_SHARE_WINDOW_MS = 1500;

/**
 * In `single` mode, whether this client should stop its own share because
 * someone else's just appeared. Normally yes: their share arrived after ours
 * started, so it's the newer one. When both started at nearly the same moment,
 * each side sees the other's as newer, so both would stop — instead the
 * identity comparison picks exactly one to yield, identically on both ends.
 */
export function shouldYieldScreenShare(input: {
	ownStartedAt: number;
	now: number;
	ownIdentity: string;
	otherIdentity: string;
}): boolean {
	if (input.now - input.ownStartedAt >= SIMULTANEOUS_SHARE_WINDOW_MS) return true;
	return input.ownIdentity < input.otherIdentity;
}
