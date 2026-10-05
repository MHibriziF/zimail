import { redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import { authorizeApiRequest, canAccessDuringFirstLogin } from '$lib/server/api-access';
import { getApiTokenService, readBearerToken } from '$lib/server/api-tokens';
import { getAuthService, readSessionToken } from '$lib/server/auth';
import { PUBLISHED_FEED_PREFIX } from '$lib/server/calendar-publish/paths';
import { DOMAIN_COOKIE, UI_THEME_COOKIE, UI_THEME_COOKIE_MAX_AGE } from '$lib/server/constants';
import { getDomainsService } from '$lib/server/domains';
import { ensureSchema } from '$lib/server/migrations/migrate';
import { isPublicPath, pageRedirect } from '$lib/server/page-access';
import { finishHead } from '$lib/server/page-head';
import { APP_NAME } from '$lib/constants';
import { translate } from '$lib/i18n/translate';
import { BUILTIN_THEME_IDS, DEFAULT_UI_THEME, parseThemeId } from '$lib/ui-theme/ids';
import {
	DEFAULT_LOCALE,
	LOCALE_COOKIE,
	LOCALE_COOKIE_MAX_AGE,
	localeFromAcceptLanguage,
	matchLocale
} from '$lib/i18n/locales';

type Resolve = Parameters<Handle>[0]['resolve'];

function jsonError(error: string, status: number): Response {
	return new Response(JSON.stringify({ error }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/**
 * Serves the page with the shell already named on `<html>`.
 *
 * Stamping it server-side is what stops the wrong shell being painted and then
 * replaced once the client works out which theme this user chose.
 */
function render(event: RequestEvent, resolve: Resolve): ReturnType<Handle> {
	const uiTheme = event.locals.uiTheme || DEFAULT_UI_THEME;
	const locale = event.locals.locale || DEFAULT_LOCALE;
	const preview = {
		image: new URL('/icons/icon-512.png', event.url.origin).href,
		siteName: APP_NAME,
		// The meeting page renders only in the browser, so the server can't see its title.
		fallbackTitle: event.url.pathname.startsWith('/meet/') ? translate(locale, 'meet.title', { app: APP_NAME }) : undefined
	};
	return resolve(event, {
		transformPageChunk: ({ html }) =>
			finishHead(html.replace('<html lang="en">', `<html lang="${locale}" data-ui-theme="${uiTheme}">`), preview)
	});
}

function clearCredentials(event: RequestEvent) {
	event.locals.user = null;
	event.locals.authMethod = null;
	event.locals.apiScopes = [];
	event.locals.apiTokenId = null;
}

function resetLocals(event: RequestEvent) {
	clearCredentials(event);
	event.locals.domains = [];
	event.locals.addresses = [];
	event.locals.activeDomainId = null;
	event.locals.uiTheme = parseThemeId(event.cookies.get(UI_THEME_COOKIE), BUILTIN_THEME_IDS);
	// The cookie is the returning visitor; Accept-Language is the first one.
	event.locals.locale =
		matchLocale(event.cookies.get(LOCALE_COOKIE)) ??
		localeFromAcceptLanguage(event.request.headers.get('accept-language'));
}

/**
 * Deploy to Cloudflare provisions D1 but never migrates it, so the schema is
 * brought up to date here rather than leaving a fresh deploy broken until
 * someone runs wrangler by hand. Cached per isolate; a no-op once applied.
 */
async function migrate(db: D1Database) {
	try {
		await ensureSchema(db);
	} catch (error) {
		console.error('Could not apply database migrations', error);
	}
}

/** A session cookie for pages; a bearer token is also accepted on the API. */
async function authenticate(event: RequestEvent) {
	event.locals.user = await getAuthService(event.platform).getUserFromSession(readSessionToken(event.cookies));
	if (event.locals.user) {
		event.locals.authMethod = 'session';
		return;
	}

	const bearer = event.url.pathname.startsWith('/api/') ? readBearerToken(event.request) : null;
	const auth = bearer ? await getApiTokenService(event.platform).getUserByApiToken(bearer) : null;
	if (!auth) return;

	// A token minted before setup was completed is not a credential yet.
	if (auth.user.must_change_password) {
		clearCredentials(event);
		return;
	}
	event.locals.user = auth.user;
	event.locals.authMethod = 'api_token';
	event.locals.apiScopes = auth.scopes;
	event.locals.apiTokenId = auth.tokenId;
}

async function loadMailboxContext(event: RequestEvent, userId: string) {
	const domainsService = getDomainsService(event.platform);
	const [domains, addresses] = await Promise.all([
		domainsService.listConnected(),
		domainsService.listAddressesForUser(userId)
	]);

	event.locals.domains = domains;
	event.locals.addresses = addresses;

	// Scripts pass `?domain=`; the dashboard uses a cookie.
	const requested = event.url.pathname.startsWith('/api/')
		? event.url.searchParams.get('domain')
		: event.cookies.get(DOMAIN_COOKIE);
	event.locals.activeDomainId =
		requested && domains.some((domain) => domain.id === requested) ? requested : null;
}

function guardApi(event: RequestEvent, resolve: Resolve): ReturnType<Handle> {
	const { pathname } = event.url;
	if (isPublicPath(pathname)) return render(event, resolve);

	const { user, authMethod } = event.locals;
	if (!user || !authMethod) return jsonError('Unauthorized', 401);

	if (user.must_change_password && !canAccessDuringFirstLogin(pathname, event.request.method)) {
		return jsonError('Complete account setup before continuing', 403);
	}

	const access = authorizeApiRequest({
		pathname,
		method: event.request.method,
		authMethod,
		scopes: event.locals.apiScopes
	});
	if (!access.ok) return jsonError(access.error, access.status);

	return render(event, resolve);
}

/**
 * Mirrored into cookies so the next first paint does not have to wait on the
 * database to know which shell and language to render.
 */
function mirrorCookie(event: RequestEvent, name: string, value: string, maxAge: number) {
	if (event.cookies.get(name) === value) return;
	event.cookies.set(name, value, { path: '/', maxAge, sameSite: 'lax', httpOnly: false });
}

async function loadPreferences(event: RequestEvent, userId: string) {
	const authService = getAuthService(event.platform);
	const [storedTheme, storedLocale] = await Promise.all([
		authService.getUserUiTheme(userId),
		authService.getUserLocale(userId)
	]);
	event.locals.uiTheme = storedTheme;
	event.locals.locale = storedLocale;
	mirrorCookie(event, UI_THEME_COOKIE, storedTheme, UI_THEME_COOKIE_MAX_AGE);
	mirrorCookie(event, LOCALE_COOKIE, storedLocale, LOCALE_COOKIE_MAX_AGE);
}

export const handle: Handle = async ({ event, resolve }) => {
	const db = event.platform?.env.DB;
	const { pathname } = event.url;
	resetLocals(event);

	// Polled by other calendar apps a few times a day, so nearly always on a
	// cold isolate, where the migration check alone would read every row of
	// d1_migrations. A feed only exists once its migration has run, and its
	// token is its only credential, so it needs neither.
	if (pathname.startsWith(PUBLISHED_FEED_PREFIX)) return render(event, resolve);

	if (db) {
		await migrate(db);
		await authenticate(event);
	}

	// Webhooks authenticate with a signature, not a session.
	if (pathname.startsWith('/api/webhooks/')) return render(event, resolve);

	const user = event.locals.user;
	const member = db && user && !user.must_change_password ? user : null;
	if (member) await loadMailboxContext(event, member.id);

	if (pathname.startsWith('/api/')) return guardApi(event, resolve);

	if (member) await loadPreferences(event, member.id);

	const target = pageRedirect({
		pathname,
		user: event.locals.user,
		needsSetup: db ? (await getAuthService(event.platform).countUsers()) === 0 : false,
		needsOnboarding: event.locals.domains.length === 0 || event.locals.addresses.length === 0
	});
	if (target) throw redirect(303, target);

	return render(event, resolve);
};
