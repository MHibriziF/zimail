import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReservationsService, publicBaseUrl } from '$lib/server/reservations';
import { bookingResponse } from '$lib/server/reservations/responses';
import { slotDays } from '$lib/calendar/reservations';

/** Public: free slots from `?from=YYYY-MM-DD`, a week unless `?days=` asks for more. Busy time shows only as missing slots. */
export const GET: RequestHandler = async ({ params, url, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Unavailable' }, { status: 503 });

	const { searchParams } = url;
	const days = await getReservationsService(platform).slots(params.slug, searchParams.get('from'), slotDays(searchParams.get('days')));
	if (!days) return bookingResponse({ type: 'not_found' });
	return json({ days }, { headers: { 'Cache-Control': 'no-store' } });
};

/** Public: books one slot. The server re-checks it is still free. */
export const POST: RequestHandler = async ({ params, request, url, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Unavailable' }, { status: 503 });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const service = getReservationsService(platform);
	return bookingResponse(await service.book(params.slug, body, publicBaseUrl(platform, url.origin)));
};
