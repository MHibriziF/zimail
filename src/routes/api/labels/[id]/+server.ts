import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLabelsService } from '$lib/server/labels';
import { labelWriteResponse } from '$lib/server/labels/responses';
import { parseLabelColor } from '$lib/mail/labels';

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { name?: unknown; color?: unknown };
	const outcome = await getLabelsService(platform).update(locals.user.id, params.id, {
		name: typeof body.name === 'string' ? body.name : undefined,
		color: parseLabelColor(body.color)
	});
	return labelWriteResponse(outcome);
};

/** Removes the label everywhere it was applied; the conversations themselves are untouched. */
export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const removed = await getLabelsService(platform).remove(locals.user.id, params.id);
	return removed ? json({ ok: true }) : json({ error: 'Label not found' }, { status: 404 });
};
