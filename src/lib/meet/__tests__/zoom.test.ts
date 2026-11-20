import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_ZOOM, NO_ZOOM, ZOOM_STEP, panBy, wheelFactor, zoomAt, zoomTransform, type ZoomView } from '../zoom';

const near = (actual: ZoomView, expected: ZoomView) => {
	for (const key of ['scale', 'x', 'y'] as const) {
		assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} ≠ ${expected[key]}`);
	}
};

describe('zooming into a tile', () => {
	test('zooming about the centre keeps the centre in the middle', () => {
		near(zoomAt(NO_ZOOM, 2), { scale: 2, x: -0.5, y: -0.5 });
	});

	test('zooming about a corner keeps that corner where it was', () => {
		near(zoomAt(NO_ZOOM, 2, { x: 0, y: 0 }), { scale: 2, x: 0, y: 0 });
		near(zoomAt(NO_ZOOM, 2, { x: 1, y: 1 }), { scale: 2, x: -1, y: -1 });
	});

	test('the point under the pointer stays under it as the zoom deepens', () => {
		const at = { x: 0.3, y: 0.7 };
		const once = zoomAt(NO_ZOOM, 2, at);
		const twice = zoomAt(once, 1.5, at);
		const contentUnder = (view: ZoomView) => ({ x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale });
		near({ scale: 1, ...contentUnder(twice) }, { scale: 1, ...contentUnder(once) });
	});

	test('it never zooms out past the whole picture, or in past the limit', () => {
		near(zoomAt(NO_ZOOM, 0.5), NO_ZOOM);
		assert.equal(zoomAt(NO_ZOOM, 100).scale, MAX_ZOOM);
	});

	test('zooming back out to 1 lands on the whole picture, wherever it was panned', () => {
		const panned = panBy(zoomAt(NO_ZOOM, 2), -0.4, 0.2);
		near(zoomAt(panned, 0.5), NO_ZOOM);
	});
});

describe('looking around a zoomed tile', () => {
	test('dragging moves the picture with the pointer', () => {
		near(panBy({ scale: 2, x: -0.5, y: -0.5 }, 0.2, -0.1), { scale: 2, x: -0.3, y: -0.6 });
	});

	test('the picture never leaves a gap at an edge', () => {
		near(panBy({ scale: 2, x: -0.5, y: -0.5 }, 5, -5), { scale: 2, x: 0, y: -1 });
	});

	test('an unzoomed picture does not move', () => {
		near(panBy(NO_ZOOM, 0.3, 0.3), NO_ZOOM);
	});
});

describe('the wheel and the transform', () => {
	test('one notch either way is one step, and a big flick is still one step', () => {
		assert.equal(wheelFactor(-100), ZOOM_STEP);
		assert.equal(wheelFactor(100), 1 / ZOOM_STEP);
		assert.equal(wheelFactor(-1000), ZOOM_STEP);
	});

	test('a pinch sends small deltas that zoom a little', () => {
		const factor = wheelFactor(-10);
		assert.ok(factor > 1 && factor < ZOOM_STEP);
	});

	test('an unzoomed tile has no transform at all', () => {
		assert.equal(zoomTransform(NO_ZOOM), '');
	});

	test('a zoomed tile is moved by a share of its own size, then scaled', () => {
		assert.equal(zoomTransform({ scale: 2, x: -0.5, y: -0.25 }), 'translate(-50%, -25%) scale(2)');
	});
});
