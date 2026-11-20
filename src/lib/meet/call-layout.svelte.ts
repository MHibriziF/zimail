import {
	clampPage,
	featuredFirst,
	layoutCallTiles,
	pageArrowTop,
	placeOnPage,
	swipeStep,
	type TileRect
} from './tile-layout';

/**
 * Arranges the call's tiles in the grid: a featured share on the stage, the
 * rest in pages that slide sideways, with arrows and a swipe to move between
 * them. The tiles are hand-built DOM, so this watches the grid itself (size,
 * children, `hidden`/`class`) rather than any state. Construct it while the
 * component initialises and `bind:this` the grid to `grid`.
 */
export class CallLayout {
	grid = $state<HTMLDivElement>();
	page = $state(0);
	pages = $state(1);
	/** Level with the paged tiles, so under a screen share the arrows sit by the strip, not over the screen. */
	arrowTop = $state('50%');
	private frame = 0;
	private swipeStart: { x: number; y: number } | null = null;

	constructor() {
		$effect(() => {
			const grid = this.grid;
			if (!grid) return;
			const schedule = () => this.schedule();
			const resize = new ResizeObserver(schedule);
			resize.observe(grid);
			const mutations = new MutationObserver(schedule);
			mutations.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
			const swipeStart = (event: PointerEvent) => this.handleSwipeStart(event);
			const swipeEnd = (event: PointerEvent) => this.handleSwipeEnd(event);
			const cancelSwipe = () => (this.swipeStart = null);
			grid.addEventListener('pointerdown', swipeStart);
			grid.addEventListener('pointerup', swipeEnd);
			grid.addEventListener('pointercancel', cancelSwipe);
			return () => {
				grid.removeEventListener('pointerdown', swipeStart);
				grid.removeEventListener('pointerup', swipeEnd);
				grid.removeEventListener('pointercancel', cancelSwipe);
				resize.disconnect();
				mutations.disconnect();
				cancelAnimationFrame(this.frame);
				this.frame = 0;
			};
		});
	}

	showPage(page: number) {
		this.page = clampPage(page, this.pages);
		this.schedule();
	}

	private schedule() {
		if (!this.frame) this.frame = requestAnimationFrame(() => this.layout());
	}

	private layout() {
		this.frame = 0;
		const grid = this.grid;
		if (!grid) return;
		const tiles = featuredFirst(visibleTiles(grid), isFeatured);
		const { clientWidth: width, clientHeight: height } = grid;
		const layout = layoutCallTiles(tiles.length, tiles.length > 0 && isFeatured(tiles[0]), width, height);
		this.pages = layout.pages;
		this.page = clampPage(this.page, layout.pages);
		this.arrowTop = pageArrowTop(layout);
		tiles.forEach((el, index) => placeTile(el, layout.rects[index], this.page, width));
	}

	private handleSwipeStart(event: PointerEvent) {
		this.swipeStart = event.pointerType === 'mouse' || this.pages < 2 ? null : { x: event.clientX, y: event.clientY };
	}

	private handleSwipeEnd(event: PointerEvent) {
		if (!this.swipeStart) return;
		const step = swipeStep(event.clientX - this.swipeStart.x, event.clientY - this.swipeStart.y);
		this.swipeStart = null;
		if (step) this.showPage(this.page + step);
	}
}

const isFeatured = (el: HTMLElement) => el.classList.contains('call-tile-featured');

function visibleTiles(grid: HTMLElement): HTMLElement[] {
	return Array.from(
		grid.querySelectorAll<HTMLElement>(':scope > .call-tile, :scope > .call-tile-group > .call-tile')
	).filter((el) => !el.hidden);
}

function placeTile(el: HTMLElement, rect: TileRect | undefined, page: number, pageWidth: number) {
	if (!rect) return;
	const box = placeOnPage(rect, page, pageWidth);
	el.style.left = `${box.left}px`;
	el.style.top = `${box.top}px`;
	el.style.width = `${box.width}px`;
	el.style.height = `${box.height}px`;
	el.inert = box.offPage;
}
