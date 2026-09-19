import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';
import { parseScreenShareMode, parseScreenSharePolicy } from '$lib/meet/screen-share';

type UpdateMeetingBody = {
	title?: unknown;
	requireApproval?: unknown;
	screenSharePolicy?: unknown;
	screenShareMode?: unknown;
};

/** Owner-only — used by the in-call host settings panel to know the meeting's current admission mode. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const meeting = await getMeetingsService(platform).getForUser(locals.user.id, params.id);
	if (!meeting) return json({ error: 'Meeting not found' }, { status: 404 });
	return json({ meeting });
};

/** Backs both the /meetings list's edit option and the in-call host settings panel — same check, same effect. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as UpdateMeetingBody;
	try {
		const meeting = await getMeetingsService(platform).update(locals.user.id, params.id, {
			title: typeof body.title === 'string' ? body.title : undefined,
			requireApproval: typeof body.requireApproval === 'boolean' ? body.requireApproval : undefined,
			screenSharePolicy: parseScreenSharePolicy(body.screenSharePolicy),
			screenShareMode: parseScreenShareMode(body.screenShareMode)
		});

		if (!meeting) return json({ error: 'Meeting not found' }, { status: 404 });
		return json({ meeting });
	} catch {
		// The setting is saved by now; what failed is pushing a policy change to the live call.
		return json({ error: 'Saved, but people already in the call could not be updated' }, { status: 502 });
	}
};
