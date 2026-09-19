/** Same cap the join endpoint applies, so a rename can't produce a name a fresh join couldn't. */
export const MAX_DISPLAY_NAME_LENGTH = 100;

/** `null` when there's nothing left to show once whitespace is trimmed. */
export function normalizeDisplayName(input: string): string | null {
	const name = input.trim().replace(/\s+/g, ' ').slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
	return name || null;
}
