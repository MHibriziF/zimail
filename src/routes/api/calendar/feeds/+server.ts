import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCalendarFeedsService } from '$lib/server/calendar-feeds';
import { feedWriteResponse } from '$lib/server/calendar-feeds/responses';
import { parseLabelColor } from '$lib/mail/labels';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({ feeds: await getCalendarFeedsService(platform).list(locals.user.id) });
};

/** Subscribes and syncs once before answering, so the calendar fills in straight away. */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { name?: unknown; url?: unknown; color?: unknown };
	const outcome = await getCalendarFeedsService(platform).add(locals.user.id, {
		name: typeof body.name === 'string' ? body.name : '',
		url: typeof body.url === 'string' ? body.url : '',
		color: parseLabelColor(body.color) ?? 'blue'
	});
	return feedWriteResponse(outcome, 201);
};
