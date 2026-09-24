import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReservationsService } from '$lib/server/reservations';
import { pageWriteResponse } from '$lib/server/reservations/responses';

/** Replaces the page's settings; the editor always sends all of them. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	return pageWriteResponse(await getReservationsService(platform).update(locals.user.id, params.id, body));
};

/** Bookings already made stay on the calendar. */
export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const removed = await getReservationsService(platform).remove(locals.user.id, params.id);
	return removed ? json({ ok: true }) : pageWriteResponse({ type: 'not_found' });
};
