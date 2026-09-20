import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLiveKitClient } from '../livekit';

function base64urlDecode(part: string): Uint8Array {
	const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + ((4 - (part.length % 4)) % 4), '=');
	return new Uint8Array(Buffer.from(padded, 'base64'));
}

function decodeJson(part: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(base64urlDecode(part)).toString('utf8'));
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
	return Buffer.from(signature).toString('base64url');
}

describe('minting a LiveKit access token', () => {
	test('the JWT header and payload carry the expected shape', async () => {
		const client = createLiveKitClient('the-key', 'the-secret', 'wss://example.livekit.cloud');
		const jwt = await client.createAccessToken({ identity: 'user-1', name: 'Ada', room: 'room-1' });

		const [headerPart, payloadPart] = jwt.split('.');
		assert.deepEqual(decodeJson(headerPart), { alg: 'HS256', typ: 'JWT' });

		const payload = decodeJson(payloadPart);
		assert.equal(payload.iss, 'the-key');
		assert.equal(payload.sub, 'user-1');
		assert.equal(payload.name, 'Ada');
		assert.equal(typeof payload.exp, 'number');
		assert.equal(typeof payload.nbf, 'number');
		assert.ok((payload.exp as number) > (payload.nbf as number));
		assert.deepEqual(payload.video, {
			roomJoin: true,
			room: 'room-1',
			canPublish: true,
			canSubscribe: true,
			canPublishData: true,
			canUpdateOwnMetadata: true
		});
	});

	test('attributes are a top-level claim, absent when not given', async () => {
		const client = createLiveKitClient('the-key', 'the-secret', 'wss://example.livekit.cloud');

		const withRole = await client.createAccessToken({
			identity: 'user-1',
			room: 'room-1',
			attributes: { role: 'host' }
		});
		const [, withRolePayload] = withRole.split('.');
		assert.deepEqual(decodeJson(withRolePayload).attributes, { role: 'host' });

		const withoutRole = await client.createAccessToken({ identity: 'user-1', room: 'room-1' });
		const [, withoutRolePayload] = withoutRole.split('.');
		assert.equal('attributes' in decodeJson(withoutRolePayload), false);
	});

	test('exp reflects a custom ttlSeconds', async () => {
		const client = createLiveKitClient('key', 'secret', 'wss://example.livekit.cloud');
		const jwt = await client.createAccessToken({ identity: 'user-1', room: 'room-1', ttlSeconds: 60 });

		const [, payloadPart] = jwt.split('.');
		const payload = decodeJson(payloadPart);
		assert.equal((payload.exp as number) - (payload.nbf as number), 60);
	});

	test('the signature verifies against the configured secret', async () => {
		const client = createLiveKitClient('key', 'super-secret', 'wss://example.livekit.cloud');
		const jwt = await client.createAccessToken({ identity: 'user-1', room: 'room-1' });

		const [headerPart, payloadPart, signaturePart] = jwt.split('.');
		const expected = await sign(`${headerPart}.${payloadPart}`, 'super-secret');
		assert.equal(signaturePart, expected);

		const wrong = await sign(`${headerPart}.${payloadPart}`, 'wrong-secret');
		assert.notEqual(signaturePart, wrong);
	});

	test('refuses to mint without full configuration', () => {
		assert.throws(() => createLiveKitClient('', 'secret', 'wss://example.livekit.cloud'));
		assert.throws(() => createLiveKitClient('key', '', 'wss://example.livekit.cloud'));
		assert.throws(() => createLiveKitClient('key', 'secret', ''));
	});
});

describe('screen-share permissions', () => {
	type Call = { url: string; auth: string; body: Record<string, unknown> };

	function recordingFetch(respond: (call: Call) => Response) {
		const calls: Call[] = [];
		const fetchImpl = (async (input: string, init: RequestInit) => {
			const call = {
				url: input,
				auth: (init.headers as Record<string, string>).Authorization,
				body: JSON.parse(init.body as string)
			};
			calls.push(call);
			return respond(call);
		}) as unknown as typeof fetch;
		return { calls, fetchImpl };
	}

	test('a token can be limited to camera and microphone', async () => {
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud');
		const jwt = await client.createAccessToken({
			identity: 'u',
			room: 'r',
			canPublishSources: ['camera', 'microphone']
		});
		const video = decodeJson(jwt.split('.')[1]).video as Record<string, unknown>;
		assert.deepEqual(video.canPublishSources, ['camera', 'microphone']);
	});

	test('setPublishSources calls UpdateParticipant over https, restating every grant', async () => {
		const { calls, fetchImpl } = recordingFetch(() => Response.json({}));
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud/', fetchImpl);
		await client.setPublishSources('room-1', 'guest-1', ['camera', 'microphone', 'screen_share']);

		assert.equal(calls[0].url, 'https://example.livekit.cloud/twirp/livekit.RoomService/UpdateParticipant');
		assert.deepEqual(calls[0].body, {
			room: 'room-1',
			identity: 'guest-1',
			permission: {
				can_subscribe: true,
				can_publish: true,
				can_publish_data: true,
				can_update_metadata: true,
				can_publish_sources: ['CAMERA', 'MICROPHONE', 'SCREEN_SHARE']
			}
		});
	});

	test('the admin token is scoped to the one room', async () => {
		const { calls, fetchImpl } = recordingFetch(() => Response.json({}));
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud', fetchImpl);
		await client.setPublishSources('room-1', 'guest-1', []);

		const token = calls[0].auth.replace(/^Bearer /, '');
		assert.deepEqual(decodeJson(token.split('.')[1]).video, { roomAdmin: true, room: 'room-1' });
	});

	test('listParticipants returns identities, attributes and published tracks', async () => {
		const { fetchImpl } = recordingFetch(() =>
			Response.json({
				participants: [
					{ identity: 'a', attributes: { role: 'host' }, tracks: [{ sid: 'TR_1', source: 'SCREEN_SHARE' }] },
					{ identity: 'b' }
				]
			})
		);
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud', fetchImpl);
		assert.deepEqual(await client.listParticipants('room-1'), [
			{ identity: 'a', attributes: { role: 'host' }, tracks: [{ sid: 'TR_1', source: 'SCREEN_SHARE' }] },
			{ identity: 'b', attributes: {}, tracks: [] }
		]);
	});

	test('a track without a sid is dropped rather than muted by accident later', async () => {
		const { fetchImpl } = recordingFetch(() =>
			Response.json({ participants: [{ identity: 'a', tracks: [{ source: 'SCREEN_SHARE' }, { sid: 'TR_2' }] }] })
		);
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud', fetchImpl);
		const [first] = await client.listParticipants('room-1');
		assert.deepEqual(first.tracks, [{ sid: 'TR_2', source: '' }]);
	});

	test('muteTrack asks RoomService to mute that one track', async () => {
		const { calls, fetchImpl } = recordingFetch(() => Response.json({}));
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud', fetchImpl);
		await client.muteTrack('room-1', 'guest-1', 'TR_9');

		assert.match(calls[0].url, /MutePublishedTrack$/);
		assert.deepEqual(calls[0].body, { room: 'room-1', identity: 'guest-1', track_sid: 'TR_9', muted: true });
	});

	test('listParticipants treats a missing room as empty', async () => {
		const { fetchImpl } = recordingFetch(() => Response.json({ code: 'not_found', msg: 'room not found' }, { status: 404 }));
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud', fetchImpl);
		assert.deepEqual(await client.listParticipants('room-1'), []);
	});

	test('other RoomService failures surface as errors', async () => {
		const { fetchImpl } = recordingFetch(() => Response.json({ code: 'unauthenticated' }, { status: 401 }));
		const client = createLiveKitClient('k', 's', 'wss://example.livekit.cloud', fetchImpl);
		await assert.rejects(client.setPublishSources('room-1', 'g', []), /unauthenticated/);
	});
});
