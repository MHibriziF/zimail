import { json, type RequestHandler } from '@sveltejs/kit';
import { getPreferencesService } from '$lib/server/preferences';

/** Saves accent, density, text size and font. Unknown values fall back rather than fail. */
export const PATCH: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { appearance?: unknown; panes?: unknown };
	try {
		body = (await request.json()) as { appearance?: unknown; panes?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	// Dragged pane widths are merged in, not sent with the rest (see updatePanes).
	if (body.panes && typeof body.panes === 'object') {
		const appearance = await getPreferencesService(platform).updatePanes(locals.user.id, body.panes);
		return json({ ok: true, appearance });
	}

	if (!body.appearance || typeof body.appearance !== 'object') {
		return json({ error: 'Appearance is required' }, { status: 400 });
	}

	const appearance = await getPreferencesService(platform).setAppearance(locals.user.id, body.appearance);
	return json({ ok: true, appearance });
};
