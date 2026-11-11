import { layoutCallTiles, type TileRect } from './tile-layout';

const SWIPE_THRESHOLD_PX = 50;

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

		$effect(() => {
			void this.page;
			this.schedule();
		});
	}

	showPage(page: number) {
		this.page = Math.max(0, Math.min(this.pages - 1, page));
	}

	private schedule() {
		if (!this.frame) this.frame = requestAnimationFrame(() => this.layout());
	}

	private layout() {
		this.frame = 0;
		const grid = this.grid;
		if (!grid) return;
		const tiles = stageTiles(grid);
		const featured = tiles[0]?.classList.contains('call-tile-featured') ?? false;
		const { clientWidth: width, clientHeight: height } = grid;
		const layout = layoutCallTiles(tiles.length, featured, width, height);
		this.pages = layout.pages;
		this.page = Math.min(this.page, layout.pages - 1);
		const paged = layout.rects.find((rect) => rect.page !== null);
		this.arrowTop = paged ? `${paged.y + paged.height / 2}px` : '50%';
		tiles.forEach((el, index) => placeTile(el, layout.rects[index], this.page, width));
	}

	private handleSwipeStart(event: PointerEvent) {
		this.swipeStart = event.pointerType === 'mouse' || this.pages < 2 ? null : { x: event.clientX, y: event.clientY };
	}

	private handleSwipeEnd(event: PointerEvent) {
		if (!this.swipeStart) return;
		const dx = event.clientX - this.swipeStart.x;
		const dy = event.clientY - this.swipeStart.y;
		this.swipeStart = null;
		if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
		this.showPage(dx < 0 ? this.page + 1 : this.page - 1);
	}
}

/** The featured share goes first, so it is the one the layout gives the stage. */
function stageTiles(grid: HTMLElement): HTMLElement[] {
	const tiles = Array.from(
		grid.querySelectorAll<HTMLElement>(':scope > .call-tile, :scope > .call-tile-group > .call-tile')
	).filter((el) => !el.hidden);
	const featured = tiles.find((el) => el.classList.contains('call-tile-featured'));
	return featured ? [featured, ...tiles.filter((el) => el !== featured)] : tiles;
}

/** Tiles on other pages sit a page-width away, so changing page slides them in. */
function placeTile(el: HTMLElement, rect: TileRect | undefined, page: number, pageWidth: number) {
	if (!rect) return;
	const offset = rect.page === null ? 0 : (rect.page - page) * pageWidth;
	el.style.left = `${rect.x + offset}px`;
	el.style.top = `${rect.y}px`;
	el.style.width = `${rect.width}px`;
	el.style.height = `${rect.height}px`;
	el.inert = rect.page !== null && rect.page !== page;
}
