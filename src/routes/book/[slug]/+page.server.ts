import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getReservationsService } from '$lib/server/reservations';

export const load: PageServerLoad = async ({ params, platform }) => {
	if (!platform?.env.DB) error(503, 'Unavailable');
	const page = await getReservationsService(platform).publicPage(params.slug);
	if (!page) error(404, 'This booking page is not available.');
	return { reservation: page };
};
