import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';

type ScreenShareBody = {
	identity?: unknown;
	allowed?: unknown;
};

/** Let one participant in the live call share their screen, or take that back — owner-only. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as ScreenShareBody;
	if (typeof body.identity !== 'string' || !body.identity || typeof body.allowed !== 'boolean') {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		const outcome = await getMeetingsService(platform).setScreenShareAllowed(
			locals.user.id,
			params.id,
			body.identity,
			body.allowed
		);
		if (outcome === 'meeting_not_found') return json({ error: 'Meeting not found' }, { status: 404 });
		return json({ ok: true });
	} catch {
		// Most often the participant has already left the call.
		return json({ error: 'Could not update that participant' }, { status: 502 });
	}
};
