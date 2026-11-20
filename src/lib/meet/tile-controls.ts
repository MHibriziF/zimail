import { NO_ZOOM, ZOOM_STEP, panBy, wheelFactor, zoomAt, zoomTransform, type ZoomView } from './zoom';

export type TileControlLabels = {
	fullscreen: string;
	exitFullscreen: string;
	zoomIn: string;
	zoomOut: string;
	resetZoom: string;
};

export type TileControlOptions = { zoomable: boolean; labels: TileControlLabels };

/** Past this a press is a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;

function glyph(icon: string): HTMLElement {
	const el = document.createElement('i');
	el.className = icon;
	el.setAttribute('aria-hidden', 'true');
	return el;
}

function iconButton(className: string, icon: string, label: string): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = `call-tile-control ${className}`.trimEnd();
	button.title = label;
	button.setAttribute('aria-label', label);
	button.append(glyph(icon));
	return button;
}

/**
 * A tile's own buttons: full screen for every tile and, on a screen share,
 * zoom. Zoom works while the share is on the stage or full screen, with the
 * buttons, a pinch (ctrl + wheel), the plain wheel in full screen, and a drag
 * to look around. Used as a Svelte action for the template's tiles and called
 * directly on the hand-built ones, so both get exactly the same.
 */
export function tileControls(tile: HTMLElement, options: TileControlOptions) {
	const { labels } = options;
	const media = tile.querySelector<HTMLElement>('.call-tile-media');
	const bar = document.createElement('div');
	bar.className = 'call-tile-controls';

	const fullscreen = iconButton('call-tile-fullscreen', 'ri-fullscreen-line', labels.fullscreen);
	// An iPhone can only put a <video> itself full screen, and has no fullscreenEnabled at all.
	fullscreen.hidden = !document.fullscreenEnabled;
	const isFullscreen = () => document.fullscreenElement === tile;
	fullscreen.addEventListener('click', () => {
		if (isFullscreen()) void document.exitFullscreen().catch(() => undefined);
		else void tile.requestFullscreen().catch(() => undefined);
	});
	const showFullscreenState = () => {
		const on = isFullscreen();
		const label = on ? labels.exitFullscreen : labels.fullscreen;
		fullscreen.title = label;
		fullscreen.setAttribute('aria-label', label);
		fullscreen.replaceChildren(glyph(on ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'));
	};
	tile.addEventListener('fullscreenchange', showFullscreenState);

	let view: ZoomView = NO_ZOOM;
	const zoomGroup = document.createElement('div');
	zoomGroup.className = 'call-tile-zoom';
	const zoomOut = iconButton('', 'ri-zoom-out-line', labels.zoomOut);
	const reset = iconButton('', 'ri-focus-3-line', labels.resetZoom);
	const zoomIn = iconButton('', 'ri-zoom-in-line', labels.zoomIn);
	zoomGroup.append(zoomOut, reset, zoomIn);

	const show = (next: ZoomView) => {
		view = next;
		if (media) media.style.transform = zoomTransform(view);
		const zoomed = view.scale > 1;
		tile.classList.toggle('call-tile-zoomed', zoomed);
		zoomOut.disabled = !zoomed;
		reset.disabled = !zoomed;
	};
	const zoomable = () => options.zoomable && (isFullscreen() || tile.classList.contains('call-tile-featured'));
	zoomIn.addEventListener('click', () => show(zoomAt(view, ZOOM_STEP)));
	zoomOut.addEventListener('click', () => show(zoomAt(view, 1 / ZOOM_STEP)));
	reset.addEventListener('click', () => show(NO_ZOOM));
	show(NO_ZOOM);

	const pointAt = (event: { clientX: number; clientY: number }) => {
		const box = tile.getBoundingClientRect();
		return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
	};

	// A pinch on a trackpad arrives as a wheel with ctrlKey; the plain wheel only zooms in full screen, where nothing scrolls.
	const onWheel = (event: WheelEvent) => {
		if (!zoomable() || !(event.ctrlKey || isFullscreen())) return;
		event.preventDefault();
		show(zoomAt(view, wheelFactor(event.deltaY), pointAt(event)));
	};

	let drag: { x: number; y: number; moved: number } | null = null;
	let dragged = false;
	const onPointerDown = (event: PointerEvent) => {
		if (view.scale === 1 || event.button !== 0 || bar.contains(event.target as Node)) return;
		// Not a swipe to the next page of tiles.
		event.stopPropagation();
		tile.setPointerCapture(event.pointerId);
		drag = { x: event.clientX, y: event.clientY, moved: 0 };
	};
	const onPointerMove = (event: PointerEvent) => {
		if (!drag) return;
		const box = tile.getBoundingClientRect();
		const dx = event.clientX - drag.x;
		const dy = event.clientY - drag.y;
		drag = { x: event.clientX, y: event.clientY, moved: drag.moved + Math.hypot(dx, dy) };
		show(panBy(view, dx / box.width, dy / box.height));
	};
	const onPointerUp = () => {
		dragged = (drag?.moved ?? 0) > DRAG_THRESHOLD_PX;
		drag = null;
	};
	// Letting go after a drag would otherwise read as a click, and click the tile off the stage.
	const onClickCapture = (event: MouseEvent) => {
		if (!dragged) return;
		dragged = false;
		event.stopImmediatePropagation();
	};

	// A share moved off the stage goes back to showing all of itself.
	const leftStage = new MutationObserver(() => {
		if (view.scale > 1 && !zoomable()) show(NO_ZOOM);
	});
	leftStage.observe(tile, { attributes: true, attributeFilter: ['class'] });
	const onFullscreenLeft = () => {
		if (view.scale > 1 && !zoomable()) show(NO_ZOOM);
	};

	if (options.zoomable) {
		bar.append(zoomGroup);
		tile.addEventListener('wheel', onWheel, { passive: false });
		tile.addEventListener('pointerdown', onPointerDown);
		tile.addEventListener('pointermove', onPointerMove);
		tile.addEventListener('pointerup', onPointerUp);
		tile.addEventListener('pointercancel', onPointerUp);
		tile.addEventListener('click', onClickCapture, { capture: true });
		tile.addEventListener('fullscreenchange', onFullscreenLeft);
	}
	bar.append(fullscreen);
	// The tile's own click puts it on the stage; a press on these buttons is not that.
	bar.addEventListener('click', (event) => event.stopPropagation());
	tile.append(bar);

	return {
		destroy() {
			leftStage.disconnect();
			bar.remove();
			if (media) media.style.transform = '';
			tile.classList.remove('call-tile-zoomed');
			tile.removeEventListener('fullscreenchange', showFullscreenState);
			tile.removeEventListener('fullscreenchange', onFullscreenLeft);
			tile.removeEventListener('wheel', onWheel);
			tile.removeEventListener('pointerdown', onPointerDown);
			tile.removeEventListener('pointermove', onPointerMove);
			tile.removeEventListener('pointerup', onPointerUp);
			tile.removeEventListener('pointercancel', onPointerUp);
			tile.removeEventListener('click', onClickCapture, { capture: true });
		}
	};
}
