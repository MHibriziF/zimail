import { json, type RequestHandler } from '@sveltejs/kit';
import { getAuthService } from '$lib/server/auth';
import { getDomainsService } from '$lib/server/domains';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	if (!platform?.env.DB) return json({ error: 'Database unavailable' }, { status: 503 });

	const [users, addresses] = await Promise.all([
		getAuthService(platform).listUsers(),
		getDomainsService(platform).listAllAddresses()
	]);
	return json({ users, addresses });
};

/**
 * Creates a user and their mailbox together — the address doubles as the login,
 * so an invited user lands straight in their inbox with nothing to configure.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user?.is_admin) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	if (!platform?.env.DB) return json({ error: 'Database unavailable' }, { status: 503 });
	const auth = getAuthService(platform);

	const body = (await request.json()) as {
		name?: string;
		domainId?: string;
		localPart?: string;
		password?: string;
		isAdmin?: boolean;
	};

	if (!body.name?.trim() || !body.localPart?.trim() || !body.domainId) {
		return json({ error: 'Name, address, and domain are required' }, { status: 400 });
	}

	if (!body.password || body.password.length < 8) {
		return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
	}

	const domains = getDomainsService(platform);
	const domain = await domains.getDomain(body.domainId);
	if (!domain) {
		return json({ error: 'Domain is not connected' }, { status: 400 });
	}

	const localPart = body.localPart.trim().toLowerCase().split('@')[0];

	// Tracked so a login without a mailbox can be rolled back rather than left
	// behind as an account nobody can receive mail on.
	let createdUserId: string | null = null;

	try {
		const user = await auth.createUser({
			email: `${localPart}@${domain.name}`,
			name: body.name,
			password: body.password,
			isAdmin: body.isAdmin === true,
			// The admin picks a temporary password; the person replaces it before
			// they can reach the mailbox.
			mustChangePassword: true
		});
		createdUserId = user.id;

		const address = await domains.createAddress({
			userId: user.id,
			domainId: domain.id,
			localPart,
			actorIsAdmin: true
		});

		return json({ user, address }, { status: 201 });
	} catch (error) {
		if (createdUserId) {
			try {
				await auth.deletePendingUser(createdUserId);
			} catch (cleanupError) {
				console.error('Failed to roll back user after mailbox creation failed', cleanupError);
			}
		}

		return json(
			{ error: error instanceof Error ? error.message : 'Failed to create user' },
			{ status: 400 }
		);
	}
};
