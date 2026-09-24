import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCalendarFeedsService } from '$lib/server/calendar-feeds';
import { feedWriteResponse } from '$lib/server/calendar-feeds/responses';

/** "Sync now". A failed fetch is still a 200: the feed comes back carrying its `lastError`. */
export const POST: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return feedWriteResponse(await getCalendarFeedsService(platform).sync(locals.user.id, params.id));
};
