import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCalendarService } from '$lib/server/calendar';
import { meetingsConfigured } from '$lib/server/reservations';
import { calendarWriteResponse, readEventInput } from '$lib/server/calendar/responses';
import { isValidTimeZone } from '$lib/timezone';

/** `?from=&to=` are ISO instants; `tz` is the zone all-day events are read in. */
export const GET: RequestHandler = async ({ url, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const from = new Date(url.searchParams.get('from') ?? '');
	const to = new Date(url.searchParams.get('to') ?? '');
	const tz = url.searchParams.get('tz') ?? '';
	const outcome = await getCalendarService(platform).listBetween(
		locals.user.id,
		from,
		to,
		isValidTimeZone(tz) ? tz : 'UTC'
	);
	if (outcome.type === 'invalid_range') return json({ error: 'Invalid date range' }, { status: 400 });
	return json({ events: outcome.events, meetingsAvailable: meetingsConfigured(platform) });
};

export const POST: RequestHandler = async ({ request, locals, platform, url }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const outcome = await getCalendarService(platform, url.origin).create(locals.user.id, await readEventInput(request));
	return calendarWriteResponse(outcome, 201);
};
