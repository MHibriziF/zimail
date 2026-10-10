import { json, type RequestHandler } from '@sveltejs/kit';
import { getAuthService, readSessionToken, sessionCookieOptions, SESSION_COOKIE } from '$lib/server/auth';
import { SESSION_DAYS } from '$lib/server/constants';

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Database unavailable' }, { status: 503 });

	const body = (await request.json()) as { email?: string; password?: string; code?: string };
	if (!body.email || !body.password) {
		return json({ error: 'Email and password are required' }, { status: 400 });
	}

	const result = await getAuthService(platform).login(body.email, body.password, body.code);
	if (!result.ok) {
		if (result.reason === 'locked') {
			return json(
				{ locked: true, retryAfterSeconds: result.retryAfterSeconds, error: 'Too many attempts. Try again later.' },
				{ status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } }
			);
		}
		// The prompt itself is not an error: the password was right, the form just
		// needs a second field now.
		if (result.reason === 'totp_required') {
			return json({ requiresTwoFactor: true }, { status: 401 });
		}
		if (result.reason === 'totp_invalid') {
			return json(
				{ requiresTwoFactor: true, error: 'That code did not match. Try the next one.' },
				{ status: 401 }
			);
		}
		return json({ error: 'Invalid email or password' }, { status: 401 });
	}

	cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(SESSION_DAYS * 24 * 60 * 60));

	return json({ user: result.user });
};

export const DELETE: RequestHandler = async ({ cookies, platform }) => {
	const token = readSessionToken(cookies);

	if (platform?.env.DB && token) {
		await getAuthService(platform).logout(token);
	}

	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ ok: true });
};
