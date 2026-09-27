/**
 * Linear-time replacements for regexes that backtrack on hostile input. These
 * run on incoming mail, where `<<<<…` with no closing `>` or a long run of
 * characters with no `@` would otherwise cost quadratic time.
 */

/** `value` with any run of `chars` removed from its end — `/[chars]+$/`. */
export function trimTrailing(value: string, chars: string): string {
	let end = value.length;
	while (end > 0 && chars.includes(value[end - 1])) end -= 1;
	return value.slice(0, end);
}

/** The contents of the first non-empty `<…>` — `/<([^>]+)>/`. */
export function firstAngled(value: string): string | null {
	let open = value.indexOf('<');
	while (open !== -1) {
		const close = value.indexOf('>', open + 1);
		if (close === -1) return null;
		if (close > open + 1) return value.slice(open + 1, close);
		open = value.indexOf('<', open + 1);
	}
	return null;
}

/**
 * Splits `Name <inside>` where the value ends in the bracket — `/^(.*?)<([^>]+)>$/`.
 * The bracket is the earliest `<` after the last inner `>`, as the lazy regex picks.
 */
export function splitTrailingAngled(value: string): { before: string; inside: string } | null {
	if (!value.endsWith('>')) return null;
	const body = value.slice(0, -1);
	const open = body.indexOf('<', body.lastIndexOf('>') + 1);
	if (open === -1 || open === body.length - 1) return null;
	return { before: body.slice(0, open), inside: body.slice(open + 1) };
}

/** The first whitespace/bracket-delimited word with an `@` inside it — `/[^\s<>]+@[^\s<>]+/`. */
export function firstEmailLike(value: string): string | null {
	for (const word of value.split(/[\s<>]/)) {
		const at = word.indexOf('@', 1);
		if (at !== -1 && at < word.length - 1) return word;
	}
	return null;
}
