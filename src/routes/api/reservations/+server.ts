import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReservationsService, meetingsConfigured } from '$lib/server/reservations';
import { pageWriteResponse } from '$lib/server/reservations/responses';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json({
		pages: await getReservationsService(platform).list(locals.user.id),
		meetingsAvailable: meetingsConfigured(platform)
	});
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	return pageWriteResponse(await getReservationsService(platform).create(locals.user.id, body), 201);
};
