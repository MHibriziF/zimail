import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_ROOM_SETTINGS, parseRoomSettings } from '../room-settings';

describe('parseRoomSettings', () => {
	test('accepts a complete, valid set', () => {
		const settings = { requireApproval: true, waitForHost: true, screenSharePolicy: 'approval', screenShareMode: 'single' };
		assert.deepEqual(parseRoomSettings(settings), settings);
		// Saved before waiting for the host existed: still valid, and off.
		const { waitForHost: _, ...older } = settings;
		assert.deepEqual(parseRoomSettings(older), { ...older, waitForHost: false });
		assert.equal(parseRoomSettings({ ...settings, waitForHost: 'yes' }), undefined);
		assert.deepEqual(parseRoomSettings(DEFAULT_ROOM_SETTINGS), DEFAULT_ROOM_SETTINGS);
	});

	test('rejects anything missing or out of range, rather than guessing', () => {
		for (const bad of [
			undefined,
			null,
			'open',
			{},
			{ ...DEFAULT_ROOM_SETTINGS, requireApproval: 'yes' },
			{ ...DEFAULT_ROOM_SETTINGS, screenSharePolicy: 'everyone' },
			{ ...DEFAULT_ROOM_SETTINGS, screenShareMode: undefined }
		]) {
			assert.equal(parseRoomSettings(bad), undefined, JSON.stringify(bad));
		}
	});
});
