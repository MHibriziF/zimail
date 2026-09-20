import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';

type StopShareBody = {
	identity?: unknown;
};

/**
 * Stop one participant's screen share at the server — owner-only.
 *
 * Backs the "one at a time" rule. The sharer's own client already steps aside
 * when it sees a newer share, but that is cooperative; this mutes the track at
 * the SFU, so a modified or stuck client stops being seen either way.
 */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as StopShareBody;
	if (typeof body.identity !== 'string' || !body.identity) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		const outcome = await getMeetingsService(platform).stopScreenShare(locals.user.id, params.id, body.identity);
		if (outcome === 'meeting_not_found') return json({ error: 'Meeting not found' }, { status: 404 });
		return json({ ok: true });
	} catch {
		// Most often the participant has already left the call.
		return json({ error: 'Could not stop that screen share' }, { status: 502 });
	}
};
