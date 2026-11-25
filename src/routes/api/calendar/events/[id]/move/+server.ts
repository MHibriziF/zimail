import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getReservationsService } from '$lib/server/reservations';
import type { HostMoveOutcome } from '$lib/server/reservations/service';

const REFUSALS: Record<Exclude<HostMoveOutcome, 'ok'>, { error: string; status: number }> = {
	invalid_time: { error: 'The booking has to end after it starts, within a day.', status: 400 },
	in_past: { error: 'Pick a time that hasn’t passed yet.', status: 400 },
	slot_taken: { error: 'Another booking already has that time.', status: 409 },
	not_found: { error: 'Booking not found', status: 404 }
};

/** The host moves a booking to `start`–`end`; the guest gets the updated invitation. */
export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const text = (value: unknown) => (typeof value === 'string' ? value : '');
	const outcome = await getReservationsService(platform).moveByHost(locals.user.id, params.id, text(body.start), text(body.end));
	if (outcome === 'ok') return json({ ok: true });
	const { error, status } = REFUSALS[outcome];
	return json({ error }, { status });
};
