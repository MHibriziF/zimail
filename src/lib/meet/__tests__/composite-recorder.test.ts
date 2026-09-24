import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { layoutTiles, orderSources, type CompositeSource } from '../composite-recorder';
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
