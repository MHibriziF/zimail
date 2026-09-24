import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatElapsed, pickMimeType, recordingFilename, shouldMixRemoteAudio } from '../recorder';

describe('recorder helpers', () => {
	test('prefers MP4, falls back through WebM, and gives up cleanly', () => {
		assert.equal(pickMimeType(() => true), 'video/mp4;codecs=avc1,mp4a');
		assert.equal(pickMimeType((type) => type.startsWith('video/webm')), 'video/webm;codecs=vp9,opus');
		assert.equal(pickMimeType((type) => type === 'video/webm'), 'video/webm');
		assert.equal(pickMimeType(() => false), null);
	});

	test('names the file after the meeting code and local start time', () => {
		const startedAt = new Date(2026, 8, 24, 14, 5);
		assert.equal(recordingFilename('abc-defg-hij', startedAt, 'video/webm'), 'meeting-abc-defg-hij-2026-09-24-1405.webm');
		assert.equal(recordingFilename('', startedAt, 'video/mp4;codecs=avc1'), 'meeting-2026-09-24-1405.mp4');
		assert.equal(recordingFilename('../../etc', startedAt, 'video/webm'), 'meeting-etc-2026-09-24-1405.webm');
	});

	test('elapsed time reads mm:ss, and h:mm:ss past an hour', () => {
		assert.equal(formatElapsed(0), '00:00');
		assert.equal(formatElapsed(75.9), '01:15');
		assert.equal(formatElapsed(3725), '1:02:05');
		assert.equal(formatElapsed(-3), '00:00');
	});

	test('remote voices are mixed only when the tab’s own audio isn’t captured', () => {
		assert.equal(shouldMixRemoteAudio(false), true);
		assert.equal(shouldMixRemoteAudio(true), false);
	});
});
