/**
 * Zooming into a tile's video, mostly to read a shared screen. The offset is
 * a fraction of the tile rather than pixels, so a zoomed view survives the
 * tile being resized (moving to full screen, the window changing).
 */
export type ZoomView = { scale: number; x: number; y: number };

export const NO_ZOOM: ZoomView = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 5;
/** One button press or one wheel notch. */
export const ZOOM_STEP = 1.25;
const WHEEL_NOTCH = 100;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Never smaller than the tile, and never panned past an edge of the picture. */
function within(view: ZoomView): ZoomView {
	const scale = clamp(view.scale, 1, MAX_ZOOM);
	return { scale, x: clamp(view.x, 1 - scale, 0), y: clamp(view.y, 1 - scale, 0) };
}

const CENTRE = { x: 0.5, y: 0.5 };

/** Zooms by `factor` about a point given as a fraction of the tile, so what is under it stays put. */
export function zoomAt(view: ZoomView, factor: number, at: { x: number; y: number } = CENTRE): ZoomView {
	const scale = clamp(view.scale * factor, 1, MAX_ZOOM);
	const ratio = scale / view.scale;
	return within({ scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio });
}

/** Moves the picture by a fraction of the tile, as dragging it does. */
export function panBy(view: ZoomView, dx: number, dy: number): ZoomView {
	return within({ ...view, x: view.x + dx, y: view.y + dy });
}

/** A mouse wheel notch zooms one step; a trackpad pinch sends many small deltas, which add up the same way. */
export function wheelFactor(deltaY: number): number {
	return ZOOM_STEP ** (-clamp(deltaY, -WHEEL_NOTCH, WHEEL_NOTCH) / WHEEL_NOTCH);
}

/** For `transform-origin: 0 0`: percentages of a translate are of the element itself, so the offset needs no size. */
export function zoomTransform(view: ZoomView): string {
	return view.scale === 1 ? '' : `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.scale})`;
}
