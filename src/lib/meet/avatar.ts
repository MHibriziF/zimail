/** What stands in for a participant without a camera: their initials on a stable colour. */

export function initialsFor(name: string): string {
	return (
		name
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]!.toUpperCase())
			.join('') || '?'
	);
}

/** A stable colour per identity, so returning to a tile always looks the same. The hue is kept in range as it goes, so nothing overflows. */
export function colorFor(seed: string): string {
	let hue = 0;
	for (const char of seed) hue = (hue * 31 + (char.codePointAt(0) ?? 0)) % 360;
	return `hsl(${hue}, 45%, 38%)`;
}
