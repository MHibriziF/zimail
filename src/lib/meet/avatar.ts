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

/** A stable colour per identity, so returning to a tile always looks the same. */
export function colorFor(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	return `hsl(${Math.abs(hash) % 360}, 45%, 38%)`;
}
