import { json, type RequestHandler } from '@sveltejs/kit';
import { getPreferencesService } from '$lib/server/preferences';
import { UI_THEME_COOKIE, UI_THEME_COOKIE_MAX_AGE } from '$lib/server/constants';
import { parseThemeId } from '$lib/ui-theme/ids';
import { listThemeIds } from '$lib/ui-theme/registry';

export const PATCH: RequestHandler = async ({ request, locals, platform, cookies }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: { theme?: unknown };
	try {
		body = (await request.json()) as { theme?: unknown };
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	if (typeof body.theme !== 'string') {
		return json({ error: 'Theme is required' }, { status: 400 });
	}

	// parseThemeId falls back to the default rather than failing, so an id that
	// comes back changed is an id we do not have.
	const theme = parseThemeId(body.theme, listThemeIds());
	if (theme !== body.theme) {
		return json({ error: 'Unknown theme' }, { status: 400 });
	}

	await getPreferencesService(platform).setUiTheme(locals.user.id, theme);
	// Not httpOnly: the client mirrors it so the shell survives a hard reload
	// before any JavaScript has run.
	cookies.set(UI_THEME_COOKIE, theme, {
		path: '/',
		maxAge: UI_THEME_COOKIE_MAX_AGE,
		sameSite: 'lax',
		httpOnly: false
	});

	return json({ ok: true, theme });
};
