import { json, type RequestHandler } from '@sveltejs/kit';
import { getAuthService, sessionCookieOptions, SESSION_COOKIE } from '$lib/server/auth';
import { SESSION_DAYS } from '$lib/server/constants';
import {
	ConfigError,
	safeEmailProviderKind,
	hasProviderConfigured,
	ProviderError
} from '$lib/server/context';
import { getDomainsService } from '$lib/server/domains';

export const GET: RequestHandler = async ({ platform }) => {
	const db = platform?.env.DB;
	if (!db) {
		return json({ ready: false, needsSetup: true, providerConfigured: false, providerKind: 'resend' });
	}

	const users = await getAuthService(platform).countUsers();
	return json({
		ready: true,
		needsSetup: users === 0,
		providerConfigured: hasProviderConfigured(platform),
		providerKind: safeEmailProviderKind(platform)
	});
};

/**
 * First-run bootstrap, done in one shot: connect the chosen provider domain,
 * create the admin, claim their address, make them the catch-all, sign them in.
 */
export const POST: RequestHandler = async ({ request, cookies, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Database unavailable' }, { status: 503 });
	const auth = getAuthService(platform);

	// The whole endpoint is only open while the app is uninitialised.
	if ((await auth.countUsers()) > 0) {
		return json({ error: 'Setup already completed' }, { status: 400 });
	}

	const body = (await request.json()) as {
		domainId?: string;
		localPart?: string;
		name?: string;
		password?: string;
	};

	if (!body.domainId) {
		return json({ error: 'Choose a domain first' }, { status: 400 });
	}
	if (!body.name?.trim()) {
		return json({ error: 'Your name is required' }, { status: 400 });
	}
	if (!body.localPart?.trim()) {
		return json({ error: 'Choose an address' }, { status: 400 });
	}
	if (!body.password || body.password.length < 8) {
		return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
	}

	try {
		const domains = getDomainsService(platform);
		const [domain] = await domains.connect([body.domainId]);

		const localPart = body.localPart.trim().toLowerCase().split('@')[0];
		const address = `${localPart}@${domain.name}`;

		// The mail address doubles as the login — one identity, not two.
		const user = await auth.bootstrapAdmin({
			email: address,
			name: body.name,
			password: body.password
		});

		await domains.createAddress({ userId: user.id, domainId: domain.id, localPart, actorIsAdmin: true });

		// The provider accepts mail for every mailbox on the domain; without a
		// catch-all anything sent to an unknown address would just pile up unrouted.
		await domains.setCatchallUser(domain.id, user.id);

		// The account was created a few lines up, so identity is already proven.
		const session = await auth.startSession(user);
		cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60));

		return json({ ok: true, email: address, signedIn: Boolean(session) });
	} catch (error) {
		const message =
			error instanceof ConfigError || error instanceof ProviderError
				? error.message
				: error instanceof Error
					? error.message
					: 'Setup failed';

		return json({ error: message }, { status: 400 });
	}
};
