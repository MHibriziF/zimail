import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReservationsService } from '$lib/server/reservations';
import { bookingResponse } from '$lib/server/reservations/responses';

/** Public: a week of free slots from `?from=YYYY-MM-DD`. Busy time shows only as missing slots. */
export const GET: RequestHandler = async ({ params, url, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Unavailable' }, { status: 503 });

	const days = await getReservationsService(platform).slots(params.slug, url.searchParams.get('from'));
	if (!days) return bookingResponse({ type: 'not_found' });
	return json({ days }, { headers: { 'Cache-Control': 'no-store' } });
};

/** Public: books one slot. The server re-checks it is still free. */
export const POST: RequestHandler = async ({ params, request, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Unavailable' }, { status: 503 });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	return bookingResponse(await getReservationsService(platform).book(params.slug, body));
};
