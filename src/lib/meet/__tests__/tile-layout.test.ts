import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { layoutCallTiles, tilesPerPage, type TileRect } from '../tile-layout';

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
