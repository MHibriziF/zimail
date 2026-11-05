import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReservationsService } from '$lib/server/reservations';

/** The guest's booking as a calendar file, for mail that doesn't add invitations by itself. Always the current time. */
export const GET: RequestHandler = async ({ params, platform }) => {
	if (!platform?.env.DB) error(503, 'Unavailable');
	const found = await getReservationsService(platform).bookingIcsFor(params.token);
	if (!found) error(404, 'This link doesn’t match a reservation any more.');
	const filename = `${found.title.replaceAll(/[^\w -]+/g, '').trim().slice(0, 60) || 'booking'}.ics`;
	return new Response(found.ics, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
