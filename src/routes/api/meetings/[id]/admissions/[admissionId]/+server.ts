import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';

type AdmissionActionBody = {
	action?: unknown;
};

/** Admit or deny one pending join request — owner-only. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as AdmissionActionBody;
	if (body.action !== 'admit' && body.action !== 'deny') {
		return json({ error: 'Invalid action' }, { status: 400 });
	}

	const status = body.action === 'admit' ? 'admitted' : 'denied';
	const outcome = await getMeetingsService(platform).decideAdmission(
		locals.user.id,
		params.id,
		params.admissionId,
		status
	);

	if (outcome === 'meeting_not_found') return json({ error: 'Meeting not found' }, { status: 404 });
	if (outcome === 'admission_not_found') return json({ error: 'Request not found' }, { status: 404 });
	if (outcome === 'already_decided') return json({ error: 'Request already answered' }, { status: 409 });

	return json({ ok: true });
};
