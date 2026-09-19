/**
 * Minimal LiveKit access-token minting, implemented with Web Crypto so it
 * runs on Workers without the `livekit-server-sdk` dependency.
 *
 * LiveKit rooms are created implicitly on first join. The only admin calls are
 * the two RoomService methods screen-share approval needs, made over LiveKit's
 * Twirp JSON API with the same hand-signed JWTs.
 *
 * Docs: https://docs.livekit.io/home/get-started/authentication/
 * RoomService: https://docs.livekit.io/reference/server/server-apis/
 */

export class LiveKitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LiveKitError';
	}
}

/** Lower-case names are what a token's `canPublishSources` grant takes. */
export type TrackSourceName = 'camera' | 'microphone' | 'screen_share' | 'screen_share_audio';

export const ALL_TRACK_SOURCES: TrackSourceName[] = ['camera', 'microphone', 'screen_share', 'screen_share_audio'];
export const NON_SCREEN_TRACK_SOURCES: TrackSourceName[] = ['camera', 'microphone'];

export type RoomParticipant = { identity: string; attributes: Record<string, string> };

type AccessTokenOptions = {
	identity: string;
	name?: string;
	room: string;
	/** How long the token is valid to establish the *initial* connection. */
	ttlSeconds?: number;
	/** Initial participant attributes — a top-level JWT claim, not part of the `video` grant. Self-editable, so never trust them for authority. */
	attributes?: Record<string, string>;
	/** Omitted means every source is allowed. */
	canPublishSources?: TrackSourceName[];
};

export type LiveKitClient = {
	/** wss:// URL the browser connects to directly. */
	url: string;
	createAccessToken(options: AccessTokenOptions): Promise<string>;
	/** Everyone currently in the room; empty if the room doesn't exist (no one has joined yet). */
	listParticipants(room: string): Promise<RoomParticipant[]>;
	/** Replaces what one participant may publish, taking effect immediately in the live call. */
	setPublishSources(room: string, identity: string, sources: TrackSourceName[]): Promise<void>;
};

export function createLiveKitClient(
	apiKey: string,
	apiSecret: string,
	url: string,
	fetchImpl: typeof fetch = fetch
): LiveKitClient {
	if (!apiKey || !apiSecret || !url) {
		throw new LiveKitError('LiveKit is not configured');
	}

	async function signClaims(claims: Record<string, unknown>, ttlSeconds: number): Promise<string> {
		const now = Math.floor(Date.now() / 1000);
		const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
		const payload = base64url(JSON.stringify({ iss: apiKey, nbf: now, exp: now + ttlSeconds, ...claims }));
		const signature = await sign(`${header}.${payload}`, apiSecret);
		return `${header}.${payload}.${signature}`;
	}

	/** One RoomService call. A room-scoped admin token, minted per call and valid for a minute. */
	async function roomService<T>(method: string, room: string, body: Record<string, unknown>): Promise<T> {
		const token = await signClaims({ video: { roomAdmin: true, room } }, 60);
		const response = await fetchImpl(`${httpBaseUrl(url)}/twirp/livekit.RoomService/${method}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ room, ...body })
		});
		if (!response.ok) {
			const error = (await response.json().catch(() => ({}))) as { code?: string; msg?: string };
			throw new LiveKitError(`RoomService.${method} failed: ${error.code ?? response.status}${error.msg ? ` (${error.msg})` : ''}`);
		}
		return (await response.json()) as T;
	}

	return {
		url,
		createAccessToken({ identity, name, room, ttlSeconds = 900, attributes, canPublishSources }) {
			return signClaims(
				{
					sub: identity,
					name,
					...(attributes ? { attributes } : {}),
					video: {
						roomJoin: true,
						room,
						canPublish: true,
						canSubscribe: true,
						canPublishData: true,
						// Without this, a participant's own setAttributes()/setName() calls (deafened
						// badge, renaming) are silently rejected by the server.
						canUpdateOwnMetadata: true,
						...(canPublishSources ? { canPublishSources } : {})
					}
				},
				ttlSeconds
			);
		},

		async listParticipants(room) {
			try {
				const body = await roomService<{ participants?: { identity: string; attributes?: Record<string, string> }[] }>(
					'ListParticipants',
					room,
					{}
				);
				return (body.participants ?? []).map((p) => ({ identity: p.identity, attributes: p.attributes ?? {} }));
			} catch (error) {
				// A room only exists while someone is in it — no room just means no one to update.
				if (error instanceof LiveKitError && /not_found/.test(error.message)) return [];
				throw error;
			}
		},

		async setPublishSources(room, identity, sources) {
			// UpdateParticipant replaces the whole permission object, so every grant the
			// join token gave has to be restated here or it would be silently revoked.
			await roomService('UpdateParticipant', room, {
				identity,
				permission: {
					can_subscribe: true,
					can_publish: true,
					can_publish_data: true,
					can_update_metadata: true,
					can_publish_sources: sources.map((source) => source.toUpperCase())
				}
			});
		}
	};
}

/** The browser connects over wss://, but RoomService is plain HTTPS on the same host. */
function httpBaseUrl(url: string): string {
	return url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
}

async function sign(data: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
	return base64url(signature);
}

function base64url(input: string | ArrayBuffer): string {
	const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
