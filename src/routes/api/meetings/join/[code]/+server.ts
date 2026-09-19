import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';

type JoinBody = {
	name?: unknown;
};

/**
 * Join a meeting. Public — the code in the URL is the only credential, same
 * as a Google Meet/Zoom meeting code. If the meeting requires approval and
 * the requester isn't its owner, this stages a pending admission instead of
 * minting a token — see join/[code]/admission/[admissionId] for the other half.
 */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Database unavailable' }, { status: 503 });

	let body: JoinBody;
	try {
		body = (await request.json()) as JoinBody;
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : undefined;

	try {
		const outcome = await getMeetingsService(platform).requestJoin(params.code, {
			name,
			requesterId: locals.user?.id
		});

		if (outcome.type === 'not_found') {
			return json({ error: 'That code is invalid or the meeting no longer exists.' }, { status: 404 });
		}
		if (outcome.type === 'pending') {
			return json({ pending: true, admissionId: outcome.admissionId });
		}
		return json({ url: outcome.url, token: outcome.token, roomName: outcome.roomName, screenShare: outcome.screenShare });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not join meeting' },
			{ status: 503 }
		);
	}
};
