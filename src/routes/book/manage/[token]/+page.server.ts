import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getReservationsService } from '$lib/server/reservations';

export const load: PageServerLoad = async ({ params, platform }) => {
	if (!platform?.env.DB) error(503, 'Unavailable');
	const booking = await getReservationsService(platform).managedBooking(params.token);
	if (!booking) error(404, 'This link doesn’t match a reservation any more.');
	return { booking, token: params.token };
};
