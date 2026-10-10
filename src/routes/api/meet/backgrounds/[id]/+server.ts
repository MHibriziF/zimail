import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCallBackgroundsService } from '$lib/server/meet/call-backgrounds';
import { storedFileHeaders } from '$lib/server/file-response';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB || !platform?.env.ATTACHMENTS) {
		throw error(401, 'Unauthorized');
	}

	const backgrounds = getCallBackgroundsService(platform);
	const background = await backgrounds.getForUser(locals.user.id, params.id);
	if (!background) throw error(404, 'Background not found');

	const bytes = await backgrounds.readBytes(background);
	if (!bytes) throw error(404, 'Background not found');

	return new Response(new Uint8Array(bytes), {
		headers: storedFileHeaders({
			contentType: background.content_type,
			size: bytes.length,
			cacheControl: 'private, max-age=86400'
		})
	});
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB || !platform?.env.ATTACHMENTS) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const deleted = await getCallBackgroundsService(platform).remove(locals.user.id, params.id);
	if (!deleted) return json({ error: 'Background not found' }, { status: 404 });

	return json({ ok: true });
};
