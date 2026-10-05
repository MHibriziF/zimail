import type { RequestHandler } from './$types';
import { getCalendarPublishService } from '$lib/server/calendar-publish';
import { publicBaseUrl } from '$lib/server/reservations';

async function etagOf(body: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body));
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `"${hex}"`;
}

/** A subscribed calendar app polling the user's published feed (#170). */
export const GET: RequestHandler = async ({ params, request, platform, url }) => {
	const token = params.file.endsWith('.ics') ? params.file.slice(0, -'.ics'.length) : params.file;
	const ics = token ? await getCalendarPublishService(platform, { baseUrl: publicBaseUrl(platform, url.origin) }).feed(token) : null;
	if (ics === null) return new Response('Not found', { status: 404 });

	const etag = await etagOf(ics);
	const headers = {
		'Content-Type': 'text/calendar; charset=utf-8',
		'Cache-Control': 'private, max-age=0, must-revalidate',
		ETag: etag
	};
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
	return new Response(ics, { headers });
};
