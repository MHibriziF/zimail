import {
	DEFAULT_SCREEN_SHARE,
	parseScreenShareMode,
	parseScreenSharePolicy,
	type ScreenShareMode,
	type ScreenSharePolicy
} from './screen-share';

/** How a meeting room admits people and handles screen sharing — what an event can set on its room. */
export type RoomSettings = {
	requireApproval: boolean;
	/** Guests can't get in until the host has joined once. */
	waitForHost: boolean;
	screenSharePolicy: ScreenSharePolicy;
	screenShareMode: ScreenShareMode;
};

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
	requireApproval: false,
	waitForHost: false,
	screenSharePolicy: DEFAULT_SCREEN_SHARE.policy,
	screenShareMode: DEFAULT_SCREEN_SHARE.mode
};

/** Settings from an untrusted body, or `undefined` unless every field is valid. */
export function parseRoomSettings(value: unknown): RoomSettings | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const fields = value as Record<string, unknown>;
	const screenSharePolicy = parseScreenSharePolicy(fields.screenSharePolicy);
	const screenShareMode = parseScreenShareMode(fields.screenShareMode);
	if (typeof fields.requireApproval !== 'boolean' || !screenSharePolicy || !screenShareMode) return undefined;
	// Added later than the rest, so a body without it still parses, as off.
	const waitForHost = fields.waitForHost ?? false;
	if (typeof waitForHost !== 'boolean') return undefined;
	return { requireApproval: fields.requireApproval, waitForHost, screenSharePolicy, screenShareMode };
}
