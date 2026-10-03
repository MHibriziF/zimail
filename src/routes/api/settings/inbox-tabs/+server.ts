import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCategoriesService, type ResortOutcome } from '$lib/server/categories';

/** Whether the inbox is split into tabs, whether Clef sorts them, and whether this deploy can run it. */
export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const settings = await getCategoriesService(platform).tabSettings(locals.user.id);
	return json({ ...settings, aiAvailable: Boolean(platform.env.AI) });
};

const RESORT_STATUS: Record<Exclude<ResortOutcome['kind'], 'sorted'>, number> = {
	disabled: 409,
	unavailable: 503,
	limit_reached: 429,
	failed: 502
};

/**
 * `{ enabled }` switches tabs on or off; `{ ai }` switches sorting with Clef;
 * `{ backfill: true }` sorts one batch of mail that arrived before tabs existed
 * and says how much is left, so the page can keep calling until it reaches zero
 * without any one request running long; `{ resort: true }` re-sorts the newest
 * conversations with Clef, one capped batch per click.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as {
		enabled?: unknown;
		ai?: unknown;
		backfill?: unknown;
		resort?: unknown;
	};
	const service = getCategoriesService(platform);

	if (typeof body.enabled === 'boolean') {
		await service.setTabsEnabled(locals.user.id, body.enabled);
		return json({ enabled: body.enabled });
	}
	if (typeof body.ai === 'boolean') {
		await service.setAiTabsEnabled(locals.user.id, body.ai);
		return json({ ai: body.ai });
	}
	if (body.backfill === true) {
		return json(await service.backfill(locals.user.id));
	}
	if (body.resort === true) {
		const outcome = await service.resortWithAi(locals.user.id);
		if (outcome.kind === 'sorted') return json({ sorted: outcome.sorted, moved: outcome.moved });
		return json({ error: outcome.kind }, { status: RESORT_STATUS[outcome.kind] });
	}
	return json({ error: 'Invalid request' }, { status: 400 });
};
