import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCalendarFeedsService } from '$lib/server/calendar-feeds';
import { feedWriteResponse } from '$lib/server/calendar-feeds/responses';
import { parseLabelColor } from '$lib/mail/labels';

/** Renames or recolors. The address itself can't be changed — remove and re-add instead. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as { name?: unknown; color?: unknown };
	const outcome = await getCalendarFeedsService(platform).update(locals.user.id, params.id, {
		name: typeof body.name === 'string' ? body.name : undefined,
		color: parseLabelColor(body.color)
	});
	return feedWriteResponse(outcome);
};

/** Unsubscribes and removes every event the feed brought in. */
export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const removed = await getCalendarFeedsService(platform).remove(locals.user.id, params.id);
	return removed ? json({ ok: true }) : feedWriteResponse({ type: 'not_found' });
};
