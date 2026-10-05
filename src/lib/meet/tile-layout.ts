/**
 * Where each call tile goes on the stage. The stage pages horizontally: a
 * tile's rect is relative to its own page, and `page` says which one it is on
 * (`null` for the featured screen share, which stays put on every page).
 */
export type TileRect = { x: number; y: number; width: number; height: number; page: number | null };

export type TileLayout = { pages: number; rects: TileRect[] };

const GAP = 12;
/** Past this a page is a wall of thumbnails nobody can watch. */
const MAX_PER_PAGE = 25;
const WIDE_ASPECT = 16 / 9;

/** The smallest tile still worth showing; a phone gets smaller ones so a page holds more than one. */
function minTileSize(width: number): { width: number; height: number } {
	return width < 640 ? { width: 150, height: 110 } : { width: 240, height: 135 };
}

/** Camera tiles may run from 16:9 down to 4:3 — or to 3:4 on a portrait stage, where squat tiles waste the height. */
function minAspect(width: number, height: number): number {
	return width >= height ? 4 / 3 : 3 / 4;
}

function fitTile(cellWidth: number, cellHeight: number, lowestAspect: number): { width: number; height: number } {
	if (cellWidth / cellHeight > WIDE_ASPECT) return { width: cellHeight * WIDE_ASPECT, height: cellHeight };
	if (cellWidth / cellHeight < lowestAspect) return { width: cellWidth, height: cellWidth / lowestAspect };
	return { width: cellWidth, height: cellHeight };
}

function span(count: number, size: number): number {
	return count * size + (count - 1) * GAP;
}

/** The column count that gives `count` tiles the most area in a `width` × `height` box. */
function bestGrid(count: number, width: number, height: number) {
	const lowestAspect = minAspect(width, height);
	let best = { columns: 1, rows: count, tile: { width: 0, height: 0 } };
	for (let columns = 1; columns <= count; columns++) {
		const rows = Math.ceil(count / columns);
		const tile = fitTile((width - GAP * (columns - 1)) / columns, (height - GAP * (rows - 1)) / rows, lowestAspect);
		if (tile.width * tile.height > best.tile.width * best.tile.height) best = { columns, rows, tile };
	}
	return best;
}

/** How many tiles a page holds before they'd shrink below the minimum size. */
export function tilesPerPage(width: number, height: number): number {
	const min = minTileSize(width);
	const columns = Math.max(1, Math.floor((width + GAP) / (min.width + GAP)));
	const rows = Math.max(1, Math.floor((height + GAP) / (min.height + GAP)));
	return Math.min(MAX_PER_PAGE, columns * rows);
}

/** One page of the grid, centred, with a short last row centred too. */
function gridPage(count: number, page: number, width: number, height: number): TileRect[] {
	const { columns, rows, tile } = bestGrid(count, width, height);
	const top = (height - span(rows, tile.height)) / 2;
	return Array.from({ length: count }, (_, index) => {
		const row = Math.floor(index / columns);
		const inRow = Math.min(columns, count - row * columns);
		const left = (width - span(inRow, tile.width)) / 2;
		return {
			x: left + (index % columns) * (tile.width + GAP),
			y: top + row * (tile.height + GAP),
			width: tile.width,
			height: tile.height,
			page
		};
	});
}

function grid(count: number, width: number, height: number): TileLayout {
	const perPage = Math.min(count, tilesPerPage(width, height));
	const pages = Math.max(1, Math.ceil(count / perPage));
	const rects: TileRect[] = [];
	for (let page = 0; page < pages; page++) {
		rects.push(...gridPage(Math.min(perPage, count - page * perPage), page, width, height));
	}
	return { pages, rects };
}

/** The strip under a screen share: one row of tiles, paged when it overflows. */
function strip(count: number, top: number, width: number, height: number, aspect: number): TileLayout {
	const tileWidth = Math.min(width, height * aspect);
	const perPage = Math.max(1, Math.floor((width + GAP) / (tileWidth + GAP)));
	const pages = Math.max(1, Math.ceil(count / perPage));
	const rects = Array.from({ length: count }, (_, index) => {
		const page = Math.floor(index / perPage);
		const inPage = Math.min(perPage, count - page * perPage);
		const left = (width - span(inPage, tileWidth)) / 2;
		return { x: left + (index % perPage) * (tileWidth + GAP), y: top, width: tileWidth, height, page };
	});
	return { pages, rects };
}

/**
 * Lays out `count` tiles in a `width` × `height` stage. With `featured`, the
 * first tile is a screen share that takes most of the stage and the rest sit
 * in a strip under it; otherwise everyone shares an even grid.
 */
export function layoutCallTiles(count: number, featured: boolean, width: number, height: number): TileLayout {
	if (count === 0 || width <= 0 || height <= 0) return { pages: 1, rects: [] };
	if (!featured) return grid(count, width, height);
	const stage: TileRect = { x: 0, y: 0, width, height, page: null };
	if (count === 1) return { pages: 1, rects: [stage] };
	const stripHeight = Math.min(180, Math.max(90, height * 0.22));
	stage.height = height - stripHeight - GAP;
	// A phone held upright fits more 4:3 thumbnails across than 16:9 ones.
	const aspect = width >= height ? WIDE_ASPECT : 4 / 3;
	const rest = strip(count - 1, stage.height + GAP, width, stripHeight, aspect);
	return { pages: rest.pages, rects: [stage, ...rest.rects] };
}
