import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Window as HappyWindow } from 'happy-dom';
import { FULLSCREEN_HOST, FULLSCREEN_TILE, tileControls } from '../tile-controls';

const labels = {
	fullscreen: 'Full screen',
	exitFullscreen: 'Exit full screen',
	zoomIn: 'Zoom in',
	zoomOut: 'Zoom out',
	resetZoom: 'Reset zoom'
};

const happy = new HappyWindow();
// Seen through the standard DOM types, which is all tile-controls uses.
const window = happy as unknown as Window & typeof globalThis;
const globals = globalThis as unknown as Record<string, unknown>;
const saved = { document: globals.document, MutationObserver: globals.MutationObserver };
let fullscreenElement: Element | null = null;
let fullscreenEnabled = true;

before(() => {
	globals.document = window.document;
	globals.MutationObserver = window.MutationObserver;
	Object.defineProperty(window.document, 'fullscreenElement', { get: () => fullscreenElement, configurable: true });
	Object.defineProperty(window.document, 'fullscreenEnabled', { get: () => fullscreenEnabled, configurable: true });
	window.document.exitFullscreen = async () => {
		const leaving = fullscreenElement;
		fullscreenElement = null;
		leaving?.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true }));
	};
});

after(() => {
	globals.document = saved.document;
	globals.MutationObserver = saved.MutationObserver;
	void happy.close();
});

beforeEach(() => {
	fullscreenElement = null;
	fullscreenEnabled = true;
});

/** A 400 × 200 tile at the origin, as the browser would lay it out. */
function makeTile(featured = true) {
	const tile = window.document.createElement('div');
	tile.className = featured ? 'call-tile call-tile-featured' : 'call-tile';
	const media = window.document.createElement('div');
	media.className = 'call-tile-media';
	tile.append(media);
	window.document.body.append(tile);
	tile.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
	tile.setPointerCapture = () => undefined;
	tile.requestFullscreen = async () => {
		fullscreenElement = tile;
		tile.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true }));
	};
	return { tile, media };
}

/** happy-dom drops the modifier and position from a WheelEvent's init, so they are set by hand. */
function wheel(deltaY: number, ctrlKey = false, x = 200, y = 100) {
	const event = new window.WheelEvent('wheel', { deltaY, cancelable: true });
	for (const [key, value] of Object.entries({ ctrlKey, clientX: x, clientY: y })) {
		Object.defineProperty(event, key, { value });
	}
	return event;
}

const button = (tile: HTMLElement, label: string) => tile.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function pointer(type: string, x: number, y: number) {
	return new window.PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true });
}

describe('a tile’s full-screen button', () => {
	test('every tile gets one, and pressing it puts that tile full screen', async () => {
		const { tile } = makeTile(false);
		tileControls(tile, { zoomable: false, labels });
		button(tile, 'Full screen').click();
		await flush();
		assert.equal(fullscreenElement, tile);
		assert.ok(button(tile, 'Exit full screen'), 'the button offers the way back');
	});

	test('pressing it again leaves full screen', async () => {
		const { tile } = makeTile(false);
		tileControls(tile, { zoomable: false, labels });
		button(tile, 'Full screen').click();
		await flush();
		button(tile, 'Exit full screen').click();
		await flush();
		assert.equal(fullscreenElement, null);
		assert.ok(button(tile, 'Full screen'));
	});

	test('inside a call, the whole call goes full screen with that tile filling it', async () => {
		const call = window.document.createElement('div');
		call.setAttribute(FULLSCREEN_HOST, '');
		call.requestFullscreen = async () => {
			fullscreenElement = call;
			call.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true }));
		};
		window.document.body.append(call);
		const { tile } = makeTile(false);
		const other = makeTile(false).tile;
		call.append(tile, other);
		tileControls(tile, { zoomable: false, labels });
		tileControls(other, { zoomable: false, labels });

		button(tile, 'Full screen').click();
		await flush();
		assert.equal(fullscreenElement, call, 'the call, with its controls, is what fills the screen');
		assert.ok(tile.classList.contains(FULLSCREEN_TILE));
		assert.ok(!other.classList.contains(FULLSCREEN_TILE));
		assert.ok(button(tile, 'Exit full screen'));
		assert.ok(button(other, 'Full screen'), 'only the tile filling the screen offers the way back');

		button(tile, 'Exit full screen').click();
		await flush();
		assert.equal(fullscreenElement, null);
		assert.ok(!tile.classList.contains(FULLSCREEN_TILE));
		assert.ok(button(tile, 'Full screen'));
	});

	test('it is hidden where the browser can’t put an element full screen', () => {
		fullscreenEnabled = false;
		const { tile } = makeTile(false);
		tileControls(tile, { zoomable: false, labels });
		assert.equal(button(tile, 'Full screen').hidden, true);
	});

	test('a person’s tile has no zoom', () => {
		const { tile } = makeTile();
		tileControls(tile, { zoomable: false, labels });
		assert.equal(tile.querySelector('.call-tile-zoom'), null);
	});

	test('pressing a control is not a click on the tile', () => {
		const { tile } = makeTile();
		let clicks = 0;
		tile.addEventListener('click', () => clicks++);
		tileControls(tile, { zoomable: true, labels });
		button(tile, 'Zoom in').click();
		assert.equal(clicks, 0);
	});
});

describe('zooming a screen share', () => {
	test('zoom in scales about the centre; zoom out and reset are only offered once zoomed', () => {
		const { tile, media } = makeTile();
		tileControls(tile, { zoomable: true, labels });
		assert.equal(button(tile, 'Zoom out').disabled, true);
		assert.equal(button(tile, 'Reset zoom').disabled, true);
		button(tile, 'Zoom in').click();
		assert.equal(media.style.transform, 'translate(-12.5%, -12.5%) scale(1.25)');
		assert.ok(tile.classList.contains('call-tile-zoomed'));
		assert.equal(button(tile, 'Zoom out').disabled, false);
	});

	test('zoom out steps back, and reset goes straight to the whole screen', () => {
		const { tile, media } = makeTile();
		tileControls(tile, { zoomable: true, labels });
		button(tile, 'Zoom in').click();
		button(tile, 'Zoom in').click();
		button(tile, 'Zoom out').click();
		assert.match(media.style.transform, /scale\(1\.25\)/);
		button(tile, 'Reset zoom').click();
		assert.equal(media.style.transform, '');
		assert.ok(!tile.classList.contains('call-tile-zoomed'));
	});

	test('a pinch (ctrl + wheel) zooms about the pointer', () => {
		const { tile, media } = makeTile();
		tileControls(tile, { zoomable: true, labels });
		const pinch = wheel(-100, true, 0, 0);
		tile.dispatchEvent(pinch);
		assert.equal(media.style.transform, 'translate(0%, 0%) scale(1.25)');
		assert.equal(pinch.defaultPrevented, true);
	});

	test('the plain wheel is left to the page unless the tile is full screen', async () => {
		const { tile, media } = makeTile();
		tileControls(tile, { zoomable: true, labels });
		const scroll = wheel(-100);
		tile.dispatchEvent(scroll);
		assert.equal(media.style.transform, '');
		assert.equal(scroll.defaultPrevented, false);

		button(tile, 'Full screen').click();
		await flush();
		tile.dispatchEvent(wheel(-100));
		assert.match(media.style.transform, /scale\(1\.25\)/);
	});

	test('a share in the strip does not zoom', () => {
		const { tile, media } = makeTile(false);
		tileControls(tile, { zoomable: true, labels });
		tile.dispatchEvent(wheel(-100, true));
		assert.equal(media.style.transform, '');
	});

	test('dragging a zoomed share looks around it, and letting go is not a click', () => {
		const { tile, media } = makeTile();
		let clicks = 0;
		tile.addEventListener('click', () => clicks++);
		tileControls(tile, { zoomable: true, labels });
		button(tile, 'Zoom in').click();
		button(tile, 'Zoom in').click();
		const before = media.style.transform;

		let swipeSeen = false;
		window.document.body.addEventListener('pointerdown', () => (swipeSeen = true));
		tile.dispatchEvent(pointer('pointerdown', 200, 100));
		tile.dispatchEvent(pointer('pointermove', 240, 120));
		tile.dispatchEvent(pointer('pointerup', 240, 120));
		tile.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

		assert.notEqual(media.style.transform, before);
		assert.equal(swipeSeen, false, 'the grid never sees it as a swipe');
		assert.equal(clicks, 0);

		tile.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(clicks, 1, 'the next real click still works');
	});

	test('pressing an unzoomed share is an ordinary click', () => {
		const { tile } = makeTile();
		let clicks = 0;
		tile.addEventListener('click', () => clicks++);
		tileControls(tile, { zoomable: true, labels });
		tile.dispatchEvent(pointer('pointerdown', 200, 100));
		tile.dispatchEvent(pointer('pointerup', 200, 100));
		tile.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(clicks, 1);
	});

	test('a zoomed share moved off the stage shows its whole screen again', async () => {
		const { tile, media } = makeTile();
		tileControls(tile, { zoomable: true, labels });
		button(tile, 'Zoom in').click();
		tile.classList.remove('call-tile-featured');
		await flush();
		assert.equal(media.style.transform, '');
	});

	test('leaving full screen off the stage shows the whole screen again', async () => {
		const { tile, media } = makeTile(false);
		tileControls(tile, { zoomable: true, labels });
		button(tile, 'Full screen').click();
		await flush();
		button(tile, 'Zoom in').click();
		assert.notEqual(media.style.transform, '');
		await window.document.exitFullscreen();
		assert.equal(media.style.transform, '');
	});

	test('taking the controls off leaves the tile as it was', () => {
		const { tile, media } = makeTile();
		const controls = tileControls(tile, { zoomable: true, labels });
		button(tile, 'Zoom in').click();
		controls.destroy();
		assert.equal(tile.querySelector('.call-tile-controls'), null);
		assert.equal(media.style.transform, '');
		assert.ok(!tile.classList.contains('call-tile-zoomed'));
	});
});
