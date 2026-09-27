import { json, type RequestHandler } from '@sveltejs/kit';
import { getAuthService, SESSION_COOKIE } from '$lib/server/auth';

type SetupErrorCode =
	| 'unauthorized'
	| 'already_complete'
	| 'database_unavailable'
	| 'invalid_request'
	| 'name_required'
	| 'name_too_long'
	| 'password_too_short'
	| 'password_too_long'
	| 'password_mismatch'
	| 'password_reused'
	| 'unknown';

type SetupInput = { name: string; password: string };

function setupError(code: SetupErrorCode, status: number) {
	return json({ code }, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
	try {
		const parsed: unknown = await request.json();
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function validate(body: Record<string, unknown>): SetupInput | SetupErrorCode {
	const { name, password, confirmPassword } = body;
	if (typeof name !== 'string' || !name.trim()) return 'name_required';
	if (name.trim().length > 128) return 'name_too_long';
	if (typeof password !== 'string' || password.length < 8) return 'password_too_short';
	if (password.length > 1024) return 'password_too_long';
	if (password !== confirmPassword) return 'password_mismatch';
	return { name, password };
}

const SERVICE_ERRORS = new Map<string, SetupErrorCode>([
	['Account setup is already complete', 'already_complete'],
	['Choose a password different from the temporary password', 'password_reused']
]);

export const POST: RequestHandler = async ({ request, locals, cookies, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return setupError('unauthorized', 401);
	}
	if (!locals.user.must_change_password) {
		return setupError('already_complete', 400);
	}

	if (!platform?.env.DB) return setupError('database_unavailable', 503);

	const body = await readBody(request);
	if (!body) return setupError('invalid_request', 400);

	const input = validate(body);
	if (typeof input === 'string') return setupError(input, 400);

	try {
		await getAuthService(platform).completeFirstLogin(locals.user.id, input);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return json({ ok: true });
	} catch (error) {
		const code = error instanceof Error ? SERVICE_ERRORS.get(error.message) : undefined;
		return code ? setupError(code, 400) : setupError('unknown', 500);
	}
};
