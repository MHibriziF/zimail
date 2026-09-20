/**
 * How much of the meeting history the /meetings page shows at once.
 *
 * The list used to load every meeting the user had ever created, and it only
 * ever grew. It now loads a page at a time, and "Show more" raises the count
 * through `?show=`. Older meetings stay reachable — they have to be, or their
 * join codes could never be deleted.
 */

export const MEETINGS_PAGE_SIZE = 25;

/** Hard ceiling, so a hand-edited `?show=` can't ask for the whole table. */
export const MAX_MEETINGS_SHOWN = 500;

/** Reads `?show=`, falling back to one page for anything missing or malformed. */
export function parseShowCount(value: string | null): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return MEETINGS_PAGE_SIZE;
	return Math.min(Math.max(Math.floor(parsed), MEETINGS_PAGE_SIZE), MAX_MEETINGS_SHOWN);
}

/** The `?show=` value for the next page, stopping at the ceiling. */
export function nextShowCount(current: number): number {
	return Math.min(current + MEETINGS_PAGE_SIZE, MAX_MEETINGS_SHOWN);
}
