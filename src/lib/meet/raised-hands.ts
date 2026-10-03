/**
 * A raised hand is the participant attribute `handRaisedAt`: when the hand
 * went up, in epoch ms, or empty once it's lowered. An attribute (rather than
 * a message) so late joiners and reconnects still see who is waiting, and the
 * timestamp is what orders them. Each participant only edits their own, which
 * is all this needs — lowering someone else's hand is a host control.
 */
export const HAND_ATTRIBUTE = 'handRaisedAt';

/** How long a participant's later raises stay silent after one has been announced. */
export const HAND_NOTICE_WINDOW_MS = 30_000;

export function parseHandRaisedAt(value: string | undefined): number | null {
	if (!value || !/^\d{1,15}$/.test(value)) return null;
	const raisedAt = Number(value);
	return raisedAt > 0 ? raisedAt : null;
}

/** Raised hands first, in the order they went up; everyone else keeps their place. */
export function orderByRaisedHand<T extends { handRaisedAt: number | null }>(people: T[]): T[] {
	const raised = people
		.filter((person) => person.handRaisedAt !== null)
		.sort((a, b) => (a.handRaisedAt ?? 0) - (b.handRaisedAt ?? 0));
	return [...raised, ...people.filter((person) => person.handRaisedAt === null)];
}
