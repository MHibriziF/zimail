import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';

/** Owner-only: ends the call for everyone, and with `delete: true` deletes the meeting too. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as { delete?: unknown };
	try {
		const outcome = await getMeetingsService(platform).end(locals.user.id, params.id, { remove: body.delete === true });
		if (outcome === 'meeting_not_found') return json({ error: 'Meeting not found' }, { status: 404 });
		return json({ ok: true });
	} catch {
		return json({ error: 'Could not end the meeting' }, { status: 502 });
	}
};
