import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReservationsService, publicBaseUrl } from '$lib/server/reservations';
import { guestChangeResponse } from '$lib/server/reservations/responses';
import { slotDays } from '$lib/calendar/reservations';

/**
 * Public: the guest's own link to their booking. The token in the path is the
 * only credential; its hash is what the booking stores.
 */
export const GET: RequestHandler = async ({ params, url, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Unavailable' }, { status: 503 });

	const { searchParams } = url;
	const days = await getReservationsService(platform).rescheduleSlots(
		params.token,
		searchParams.get('from'),
		slotDays(searchParams.get('days'))
	);
	if (!days) return guestChangeResponse({ type: 'not_found' });
	return json({ days }, { headers: { 'Cache-Control': 'no-store' } });
};

/** `{ action: 'reschedule', start }` or `{ action: 'cancel' }`. */
export const POST: RequestHandler = async ({ params, request, url, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Unavailable' }, { status: 503 });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const service = getReservationsService(platform);
	if (body.action === 'cancel') return guestChangeResponse(await service.cancelByGuest(params.token));
	if (body.action === 'reschedule') {
		return guestChangeResponse(await service.rescheduleByGuest(params.token, body, publicBaseUrl(platform, url.origin)));
	}
	return json({ error: 'Unknown action' }, { status: 400 });
};
