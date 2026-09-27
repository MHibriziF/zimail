/**
 * Splits a To/Cc header on the commas that separate addresses — not the ones
 * inside a quoted display name or an `<…>` bracket. A quote preceded by an odd
 * number of backslashes is escaped and does not open or close a name.
 */
export function splitAddressList(value: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let inQuotes = false;
	let depth = 0;
	let escaped = false;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === '"' && !escaped) inQuotes = !inQuotes;
		escaped = character === '\\' && !escaped;
		if (inQuotes) continue;

		if (character === '<') depth += 1;
		else if (character === '>' && depth > 0) depth -= 1;
		else if (character === ',' && depth === 0) {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}

	parts.push(value.slice(start));
	return parts;
}
