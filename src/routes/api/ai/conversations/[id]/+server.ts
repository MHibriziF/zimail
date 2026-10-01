import { json, type RequestHandler } from '@sveltejs/kit';
import { getAiHistoryService } from '$lib/server/ai-history';

/** One saved conversation, with its answers' cards, to carry on from. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const conversation = await getAiHistoryService(platform).get(locals.user.id, params.id ?? '');
	if (!conversation) return json({ error: 'not_found' }, { status: 404 });
	return json(conversation);
};

/** Deletes it for good: there's no soft delete for conversations. */
export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const removed = await getAiHistoryService(platform).remove(locals.user.id, params.id ?? '');
	if (!removed) return json({ error: 'not_found' }, { status: 404 });
	return json({ ok: true });
};
