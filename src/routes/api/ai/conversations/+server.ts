import { json, type RequestHandler } from '@sveltejs/kit';
import { getAiHistoryService } from '$lib/server/ai-history';

/** The user's saved Ask AI conversations, newest first: titles only. */
export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	return json({ conversations: await getAiHistoryService(platform).list(locals.user.id) });
};
