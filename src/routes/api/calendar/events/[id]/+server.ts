import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCalendarService } from '$lib/server/calendar';
import { calendarWriteResponse, readEventInput } from '$lib/server/calendar/responses';

/** One event with its guest list, which the range listing leaves out. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const found = await getCalendarService(platform).get(locals.user.id, params.id);
	return found ? json(found) : calendarWriteResponse({ type: 'not_found' });
};

/** Replaces every editable field — the editor always sends the whole event. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform, url }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const outcome = await getCalendarService(platform, url.origin).update(
		locals.user.id,
		params.id,
		await readEventInput(request)
	);
	return calendarWriteResponse(outcome);
};

export const DELETE: RequestHandler = async ({ params, locals, platform, url }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const outcome = await getCalendarService(platform, url.origin).remove(locals.user.id, params.id);
	if (outcome === 'ok') return json({ ok: true });
	return outcome === 'read_only'
		? calendarWriteResponse({ type: 'read_only' })
		: calendarWriteResponse({ type: 'not_found' });
};
