import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCategoriesService } from '$lib/server/categories';

/** Whether the inbox is split into tabs, and whether older mail still needs sorting. */
export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const service = getCategoriesService(platform);
	return json({ enabled: await service.tabsEnabled(locals.user.id) });
};

/**
 * `{ enabled }` switches tabs on or off; `{ backfill: true }` sorts one batch of
 * mail that arrived before tabs existed and says how much is left, so the page
 * can keep calling until it reaches zero without any one request running long.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; backfill?: unknown };
	const service = getCategoriesService(platform);

	if (typeof body.enabled === 'boolean') {
		await service.setTabsEnabled(locals.user.id, body.enabled);
		return json({ enabled: body.enabled });
	}
	if (body.backfill === true) {
		return json(await service.backfill(locals.user.id));
	}
	return json({ error: 'Invalid request' }, { status: 400 });
};
