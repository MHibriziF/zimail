import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCalendarPublishService, publishedFeedUrl } from '$lib/server/calendar-publish';
import { publicBaseUrl } from '$lib/server/reservations';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	return json(await getCalendarPublishService(platform).status(locals.user.id));
};

/** Starts publishing, or resets the link. The address is only shown here: only its hash is kept. */
export const POST: RequestHandler = async ({ locals, platform, url }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const service = getCalendarPublishService(platform);
	const { token } = await service.publish(locals.user.id);
	return json({
		url: publishedFeedUrl(publicBaseUrl(platform, url.origin), token),
		status: await service.status(locals.user.id)
	});
};

export const PATCH: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { includeFeeds?: unknown; busyOnly?: unknown };
	const service = getCalendarPublishService(platform);
	const outcome = await service.setOptions(locals.user.id, {
		includeFeeds: body.includeFeeds === true,
		busyOnly: body.busyOnly === true
	});
	if (outcome === 'not_published') return json({ error: 'The calendar is not published' }, { status: 404 });
	return json(await service.status(locals.user.id));
};

export const DELETE: RequestHandler = async ({ locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	await getCalendarPublishService(platform).unpublish(locals.user.id);
	return json({ published: false });
};
