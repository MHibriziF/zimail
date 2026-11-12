import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { colorFor } from '../avatar';
import { compositeSources, type RecordingParticipant } from '../recording-sources';

const track = (id: string) => ({ id }) as unknown as MediaStreamTrack;
const labels = { screenShareOf: (name: string) => `${name}'s screen` };

function participant(overrides: Partial<RecordingParticipant> = {}): RecordingParticipant {
	return { identity: 'ada', name: 'Ada Lovelace', camera: null, screen: null, ...overrides };
}

describe('compositeSources', () => {
	test('a participant without a camera is drawn as initials on their colour', () => {
		const [source] = compositeSources([participant()], labels);
		assert.deepEqual(source, {
			key: 'ada',
			label: 'Ada Lovelace',
			video: null,
			screen: false,
			color: colorFor('ada'),
			initials: 'AL'
		});
	});

	test('a camera that is on is the tile’s video', () => {
		const camera = track('cam');
		const [source] = compositeSources([participant({ camera })], labels);
		assert.equal(source.video, camera);
	});

	test('a screen share becomes its own tile, placed before the person showing it', () => {
		const screen = track('screen');
		const sources = compositeSources([participant({ screen })], labels);
		assert.deepEqual(
			sources.map(({ key, label, screen: isScreen, video }) => ({ key, label, isScreen, video })),
			[
				{ key: 'ada:screen', label: "Ada Lovelace's screen", isScreen: true, video: screen },
				{ key: 'ada', label: 'Ada Lovelace', isScreen: false, video: null }
			]
		);
	});

	test('keeps the participants’ order', () => {
		const sources = compositeSources([participant(), participant({ identity: 'bob', name: 'Bob' })], labels);
		assert.deepEqual(sources.map((source) => source.key), ['ada', 'bob']);
	});
});
