import type { User } from '$lib/types';

const PUBLIC_PREFIXES = [
	'/login',
	'/setup',
	// Account recovery is reached precisely when the user cannot sign in, and
	// the confirmation link is clicked from another inbox. Each of these carries
	// its own single-use token; the path being public grants nothing on its own.
	'/forgot',
	'/reset',
	'/account/recovery',
	'/api/auth',
	'/api/setup',
	'/api/webhooks',
	'/install.sh',
	// A meeting's join link is meant to work for invitees with no account at
	// all — the hashed token in the URL is the only credential, checked (not
	// consumed) on every visit. /api/meetings itself (creating a meeting)
	// stays authenticated; only the join sub-path is public.
	'/meet',
	'/api/meetings/join',
	// A reservation page is shared with people who have no account. It only
	// ever reveals free slots, and a booking can only take one of them.
	'/book',
	'/api/book',
	// A published calendar is polled by Google, Apple or Outlook, which send no
	// cookies: the unguessable token in the path is the credential.
	'/api/calendar/ics'
];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export type PageVisit = {
	pathname: string;
	user: User | null;
	/** No account exists yet. */
	needsSetup: boolean;
	/** The user has no connected domain or no address on one. */
	needsOnboarding: boolean;
};

/** Where a page request must be sent instead, or null to serve it. */
export function pageRedirect(visit: PageVisit): string | null {
	const entry = entryRedirect(visit);
	if (entry !== undefined) return entry;
	// entryRedirect only continues for a signed-in user.
	return memberRedirect(visit.pathname, visit.user as User, visit.needsOnboarding);
}

/** First-run, sign-in and public pages; `undefined` means the visitor is signed in and on a private page. */
function entryRedirect({ pathname, user, needsSetup }: PageVisit): string | null | undefined {
	if (needsSetup && pathname !== '/setup' && pathname !== '/install.sh') return '/setup';

	if (pathname === '/setup') {
		if (needsSetup) return null;
		return user ? '/inbox' : '/login';
	}

	if (pathname === '/login') {
		if (!user) return null;
		return user.must_change_password ? '/account/setup' : '/inbox';
	}

	if (isPublicPath(pathname)) return null;
	if (!user) return '/login';
	return undefined;
}

function memberRedirect(pathname: string, user: User, needsOnboarding: boolean): string | null {
	// Nothing else is reachable until the temporary password is replaced.
	if (user.must_change_password) return pathname === '/account/setup' ? null : '/account/setup';
	if (pathname === '/account/setup') return '/inbox';

	// Nothing works until a provider domain is connected and the user owns an
	// address on it, so send them through onboarding first.
	if (needsOnboarding) return pathname === '/onboarding' ? null : '/onboarding';
	if (pathname === '/onboarding') return '/inbox';

	if (pathname.startsWith('/admin') && !user.is_admin) return '/inbox';
	return null;
}
