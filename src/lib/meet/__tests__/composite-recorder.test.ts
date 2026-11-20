import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	drawAvatar,
	drawLabel,
	fit,
	layoutTiles,
	meetingRecordingSupported,
	orderSources,
	type CompositeSource
} from '../composite-recorder';
import { parseRecordingAttribute, recordingChoices } from '../recording-kind';

const source = (key: string, screen = false): CompositeSource => ({
	key,
	label: key,
	video: null,
	screen,
	color: '#000',
	initials: key.slice(0, 2)
});

const inside = (rect: { x: number; y: number; width: number; height: number }) =>
	rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1280 && rect.y + rect.height <= 720 && rect.width > 0 && rect.height > 0;

describe('meeting recording layout', () => {
	test('one person fills the frame, four make a 2×2 grid, five a 3-column grid', () => {
		const [solo] = layoutTiles(1, 0);
		assert.ok(solo.width > 1200 && solo.height > 690);

		const four = layoutTiles(4, 0);
		assert.equal(new Set(four.map((rect) => rect.x)).size, 2);
		assert.equal(new Set(four.map((rect) => rect.y)).size, 2);

		const five = layoutTiles(5, 0);
		assert.equal(new Set(five.map((rect) => rect.x)).size, 3);
		assert.ok(five.every(inside));
	});

	test('a screen share takes the stage with people in a column beside it', () => {
		const [stage, ...people] = layoutTiles(4, 1);
		assert.ok(stage.width > 900);
		assert.ok(people.every((rect) => rect.x >= stage.x + stage.width));
		assert.ok(people.every(inside));
		// Nobody overlaps anybody.
		for (let index = 1; index < people.length; index++) {
			assert.ok(people[index].y >= people[index - 1].y + people[index - 1].height);
		}
	});

	test('a lone screen share gets the whole stage', () => {
		assert.equal(layoutTiles(1, 1).length, 1);
	});

	test('screens come first so the first share is the one on stage', () => {
		const ordered = orderSources([source('ana'), source('ana:screen', true), source('bo')]);
		assert.deepEqual(
			ordered.map((entry) => entry.key),
			['ana:screen', 'ana', 'bo']
		);
	});
});

describe('recording kinds', () => {
	test('the attribute reads back as a kind, with the old "1" meaning a view recording', () => {
		assert.equal(parseRecordingAttribute('meeting'), 'meeting');
		assert.equal(parseRecordingAttribute('view'), 'view');
		assert.equal(parseRecordingAttribute('1'), 'view');
		assert.equal(parseRecordingAttribute('0'), null);
		assert.equal(parseRecordingAttribute(undefined), null);
	});

	test('the host can record the meeting; everyone can record their own view', () => {
		assert.deepEqual(recordingChoices({ isHost: true, meetingSupported: true, viewSupported: true }), ['meeting', 'view']);
		assert.deepEqual(recordingChoices({ isHost: false, meetingSupported: true, viewSupported: true }), ['view']);
		assert.deepEqual(recordingChoices({ isHost: true, meetingSupported: true, viewSupported: false }), ['meeting']);
		assert.deepEqual(recordingChoices({ isHost: false, meetingSupported: true, viewSupported: false }), []);
	});
});

/** Records what was drawn: each fill as the colour and box it used, each text as the string and where it went. */
function fakeContext() {
	const fills: { style: string; x: number; y: number; width: number; height: number }[] = [];
	const texts: { text: string; x: number; y: number; maxWidth?: number; font: string }[] = [];
	const arcs: { x: number; y: number; radius: number; style: string }[] = [];
	const ctx = {
		fillStyle: '',
		font: '',
		textAlign: '',
		textBaseline: '',
		fillRect(x: number, y: number, width: number, height: number) {
			fills.push({ style: ctx.fillStyle, x, y, width, height });
		},
		beginPath() {},
		arc(x: number, y: number, radius: number) {
			arcs.push({ x, y, radius, style: ctx.fillStyle });
		},
		fill() {},
		fillText(text: string, x: number, y: number, maxWidth?: number) {
			texts.push({ text, x, y, maxWidth, font: ctx.font });
		},
		measureText(text: string) {
			return { width: text.length * 10 };
		}
	};
	return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts, arcs };
}

const tile = { x: 100, y: 50, width: 400, height: 300 };

describe('meeting recording frames', () => {
	test('a camera is cropped to fill its tile, centred', () => {
		const frame = fit(1920, 1080, tile, 'cover');
		assert.equal(frame.height, tile.height);
		assert.ok(frame.width > tile.width);
		assert.ok(Math.abs(frame.x + frame.width / 2 - (tile.x + tile.width / 2)) < 1e-9);
	});

	test('a screen is shrunk to fit whole inside its tile, centred', () => {
		assert.deepEqual(fit(1920, 1080, tile, 'contain'), { x: 100, y: 87.5, width: 400, height: 225 });
	});

	test("someone without a camera is drawn as their initials on their colour, in the tile's centre", () => {
		const { ctx, fills, texts, arcs } = fakeContext();
		drawAvatar(ctx, { ...source('ana'), color: '#c026d3', initials: 'AN' }, tile);
		assert.deepEqual(fills[0], { style: '#1c1c21', ...tile });
		assert.deepEqual(arcs, [{ x: 300, y: 200, radius: 54, style: '#c026d3' }]);
		assert.equal(texts[0].text, 'AN');
		assert.equal(texts[0].x, 300);
		assert.equal(texts[0].y, 200);
	});

	test('the name sits on a dark strip in the bottom-left corner', () => {
		const { ctx, fills, texts } = fakeContext();
		drawLabel(ctx, 'Ana', tile);
		const [strip] = fills;
		assert.equal(strip.style, 'rgba(0, 0, 0, 0.55)');
		assert.equal(strip.x, tile.x + 8);
		assert.equal(strip.y + strip.height, tile.y + tile.height - 8);
		assert.equal(texts[0].text, 'Ana');
		assert.match(texts[0].font, /^500 18px/);
	});

	test('a long name is clipped to the tile rather than running past it', () => {
		const { ctx, fills, texts } = fakeContext();
		drawLabel(ctx, 'A very long name indeed that will not fit', { ...tile, width: 200 });
		assert.equal(fills[0].width, 184);
		assert.equal(texts[0].maxWidth, 184 - 18);
	});

	test('a small tile still gets a readable label', () => {
		const { ctx, texts } = fakeContext();
		drawLabel(ctx, 'Bo', { ...tile, height: 60 });
		assert.match(texts[0].font, /^500 12px/);
	});

	test('recording the meeting is off where the browser has no MediaRecorder', () => {
		assert.equal(meetingRecordingSupported(), false);
	});
});
