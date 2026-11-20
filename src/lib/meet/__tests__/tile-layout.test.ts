import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	clampPage,
	layoutCallTiles,
	pageArrowTop,
	placeOnPage,
	promoteSpeakers,
	reconcileOrder,
	swipeStep,
	tilesPerPage,
	type TileRect
} from '../tile-layout';

const inside = (width: number, height: number) => (rect: TileRect) =>
	rect.x >= 0 &&
	rect.y >= 0 &&
	rect.x + rect.width <= width + 0.001 &&
	rect.y + rect.height <= height + 0.001 &&
	rect.width > 0 &&
	rect.height > 0;

const overlaps = (a: TileRect, b: TileRect) =>
	a.page === b.page && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function assertNoOverlap(rects: TileRect[]) {
	for (let i = 0; i < rects.length; i++) {
		for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(rects[i], rects[j]), `tiles ${i} and ${j} overlap`);
	}
}

describe('call tile layout', () => {
	test('two people on a wide stage fill its height instead of sitting in a thin row', () => {
		const { pages, rects } = layoutCallTiles(2, false, 1600, 800);
		assert.equal(pages, 1);
		assert.ok(rects.every((rect) => rect.height > 500));
		assert.ok(rects.every(inside(1600, 800)));
		assertNoOverlap(rects);
	});

	test('a portrait phone stacks two people rather than squeezing them side by side', () => {
		const { rects } = layoutCallTiles(2, false, 360, 600);
		assert.equal(rects[0].x, rects[1].x);
		assert.ok(rects[1].y > rects[0].y);
	});

	test('tiles are never wider than 16:9', () => {
		const { rects } = layoutCallTiles(1, false, 2000, 400);
		assert.ok(rects[0].width / rects[0].height <= 16 / 9 + 0.001);
		assert.equal(rects[0].x, (2000 - rects[0].width) / 2);
	});

	test('more people than fit go onto further pages', () => {
		const perPage = tilesPerPage(1200, 700);
		const { pages, rects } = layoutCallTiles(perPage + 3, false, 1200, 700);
		assert.equal(pages, 2);
		assert.equal(rects.filter((rect) => rect.page === 0).length, perPage);
		assert.equal(rects.filter((rect) => rect.page === 1).length, 3);
		assert.ok(rects.every(inside(1200, 700)));
		assertNoOverlap(rects);
	});

	test('a short last row is centred', () => {
		const { rects } = layoutCallTiles(3, false, 1000, 1000);
		const last = rects[2];
		assert.ok(Math.abs(last.x + last.width / 2 - 500) < 0.001);
	});

	test('a screen share keeps the stage on every page with the others paged in a strip under it', () => {
		const { pages, rects } = layoutCallTiles(20, true, 1200, 800);
		const [stage, ...people] = rects;
		assert.equal(stage.page, null);
		assert.equal(stage.width, 1200);
		assert.ok(pages > 1);
		assert.ok(people.every((rect) => rect.y >= stage.y + stage.height));
		assert.ok(rects.every(inside(1200, 800)));
		assertNoOverlap(rects);
	});

	test('a lone screen share gets the whole stage', () => {
		assert.deepEqual(layoutCallTiles(1, true, 800, 600), {
			pages: 1,
			rects: [{ x: 0, y: 0, width: 800, height: 600, page: null }]
		});
	});

	test('an unmeasured stage lays nothing out', () => {
		assert.deepEqual(layoutCallTiles(3, false, 0, 0), { pages: 1, rects: [] });
	});
});

describe('paging the stage', () => {
	test('a page number is kept within the pages there are', () => {
		assert.equal(clampPage(5, 3), 2);
		assert.equal(clampPage(-1, 3), 0);
		assert.equal(clampPage(1, 3), 1);
	});

	test('the arrows sit level with the strip under a share, and mid-stage otherwise', () => {
		assert.equal(pageArrowTop({ pages: 2, rects: [{ x: 0, y: 0, width: 800, height: 400, page: null }, { x: 0, y: 412, width: 240, height: 120, page: 0 }] }), '472px');
		assert.equal(pageArrowTop({ pages: 1, rects: [{ x: 0, y: 0, width: 800, height: 600, page: null }] }), '50%');
	});

	test('a swipe left goes forward, right goes back', () => {
		assert.equal(swipeStep(-120, 10), 1);
		assert.equal(swipeStep(120, -10), -1);
	});

	test('a short or mostly vertical swipe does not page', () => {
		assert.equal(swipeStep(-30, 0), 0);
		assert.equal(swipeStep(-80, 200), 0);
	});

	test('a tile on another page sits a page-width away and cannot be reached', () => {
		const rect: TileRect = { x: 10, y: 20, width: 240, height: 135, page: 2 };
		assert.deepEqual(placeOnPage(rect, 0, 1000), { left: 2010, top: 20, width: 240, height: 135, offPage: true });
		assert.deepEqual(placeOnPage(rect, 2, 1000), { left: 10, top: 20, width: 240, height: 135, offPage: false });
	});

	test('the featured share stays put on every page', () => {
		const rect: TileRect = { x: 0, y: 0, width: 800, height: 400, page: null };
		assert.deepEqual(placeOnPage(rect, 3, 1000), { left: 0, top: 0, width: 800, height: 400, offPage: false });
	});
});

describe('who goes where in the grid', () => {
	test('tiles keep their places as people come and go, and newcomers join the end', () => {
		assert.deepEqual(reconcileOrder(['c', 'a', 'b'], ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd']);
		assert.deepEqual(reconcileOrder(['c', 'a', 'b'], ['a', 'b']), ['a', 'b']);
		assert.deepEqual(reconcileOrder([], ['x', 'y']), ['x', 'y']);
	});

	test('someone speaking on a page out of view comes to the front', () => {
		const firstPageOnly = (index: number) => index < 2;
		assert.deepEqual(promoteSpeakers(['a', 'b', 'c', 'd'], new Set(['d']), firstPageOnly), ['d', 'a', 'b', 'c']);
	});

	test('someone speaking who is already in view stays where they are', () => {
		const order = ['a', 'b', 'c'];
		assert.deepEqual(promoteSpeakers(order, new Set(['b']), () => true), order);
	});

	test('several people speaking out of view come forward in their own order', () => {
		const firstPageOnly = (index: number) => index < 1;
		assert.deepEqual(promoteSpeakers(['a', 'b', 'c', 'd'], new Set(['d', 'b']), firstPageOnly), ['b', 'd', 'a', 'c']);
	});
});
