import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLabelsService } from '$lib/server/labels';
import { MAX_LABELS_PER_USER } from '$lib/mail/labels';

/** Replaces the labels on the conversation this message belongs to. */
export const PUT: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { labelIds?: unknown };
	if (
		!Array.isArray(body.labelIds) ||
		body.labelIds.length > MAX_LABELS_PER_USER ||
		!body.labelIds.every((id) => typeof id === 'string')
	) {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	const labels = await getLabelsService(platform).setForMessage(locals.user.id, params.id, body.labelIds);
	return labels ? json({ labels }) : json({ error: 'Email not found' }, { status: 404 });
};
