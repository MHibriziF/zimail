import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLabelsService } from '$lib/server/labels';
import { labelWriteResponse } from '$lib/server/labels/responses';
import { parseLabelColor } from '$lib/mail/labels';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ labels: await getLabelsService(platform).list(locals.user.id) });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { name?: unknown; color?: unknown };
	const outcome = await getLabelsService(platform).create(locals.user.id, {
		name: typeof body.name === 'string' ? body.name : '',
		color: parseLabelColor(body.color) ?? 'gray'
	});
	return labelWriteResponse(outcome, 201);
};
