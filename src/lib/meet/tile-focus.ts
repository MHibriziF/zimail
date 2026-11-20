/**
 * Which tile has the stage. Every tile carries a key in `data-tile-key`, so
 * the hand-built remote tiles and the template's own can be named alike.
 */

export const personTileKey = (identity: string) => `person:${identity}`;
/** `shareKey` is the sharer's identity, or the local share's stand-in key. */
export const screenTileKey = (shareKey: string) => `screen:${shareKey}`;

/** The tile the viewer clicked, or else the screen share picked for them, or nobody. */
export function featuredTileKey(pinned: string | null, featuredShare: string | null): string | null {
	if (pinned) return pinned;
	return featuredShare === null ? null : screenTileKey(featuredShare);
}

/** Clicking the tile on the stage gives the stage back; clicking any other tile puts that one there. */
export function nextPin(clicked: string, featured: string | null): string | null {
	return clicked === featured ? null : clicked;
}

/** A pin on someone who has gone, or a share that has ended, lets go. */
export function pinAfterRemoval(pinned: string | null, removed: readonly string[]): string | null {
	return pinned !== null && removed.includes(pinned) ? null : pinned;
}
