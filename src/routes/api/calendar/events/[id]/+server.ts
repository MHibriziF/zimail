import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCalendarService } from '$lib/server/calendar';
import { calendarWriteResponse, readEventInput } from '$lib/server/calendar/responses';

/** Replaces every editable field — the editor always sends the whole event. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const outcome = await getCalendarService(platform).update(
		locals.user.id,
		params.id,
		await readEventInput(request)
	);
	return calendarWriteResponse(outcome);
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const outcome = await getCalendarService(platform).remove(locals.user.id, params.id);
	if (outcome === 'ok') return json({ ok: true });
	return outcome === 'read_only'
		? calendarWriteResponse({ type: 'read_only' })
		: calendarWriteResponse({ type: 'not_found' });
};
