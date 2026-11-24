/**
 * Turns what someone typed into an FTS5 match expression for `emails_fts`.
 *
 * Every word must match, as a prefix ("prop" finds "proposal"); text in double
 * quotes must match as that exact phrase. Only letters and digits survive, so
 * nothing typed can reach FTS5's own syntax (NEAR, column filters, `-`, `^`).
 * Returns null when nothing searchable is left, so the caller can fall back.
 */

const WORD = /[\p{L}\p{N}]+/gu;
const QUOTED = /"([^"]*)"/g;

export function ftsQuery(text: string): string | null {
	const parts: string[] = [];
	for (const [, inner] of text.matchAll(QUOTED)) {
		const words = inner.match(WORD);
		if (words) parts.push(`"${words.join(' ')}"`);
	}
	const unquoted = text.replaceAll(QUOTED, ' ');
	for (const word of unquoted.match(WORD) ?? []) parts.push(`"${word}"*`);
	return parts.length > 0 ? parts.join(' ') : null;
}

/** Several searches at once (Ask AI's terms): all of them, or any one with `any`. */
export function ftsQueryAll(terms: string[], any = false): string | null {
	const parts: string[] = [];
	for (const term of terms) {
		const part = ftsQuery(term);
		// One term with nothing searchable can't be honoured here, so none of them are.
		if (!part) return null;
		parts.push(`(${part})`);
	}
	return parts.length > 0 ? parts.join(any ? ' OR ' : ' AND ') : null;
}
