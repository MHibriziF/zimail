import { json, type RequestHandler } from '@sveltejs/kit';
import { DomainsServiceError, getDomainsService } from '$lib/server/domains';

export const GET: RequestHandler = async ({ locals, platform, url }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const domains = getDomainsService(platform);
	const all =
		url.searchParams.get('all') === '1' &&
		locals.user.is_admin &&
		(locals.authMethod === 'session' || locals.apiScopes.includes('admin'));
	const addresses = all
		? await domains.listAllAddresses()
		: await domains.listAddressesForUser(locals.user.id);

	return json({ addresses });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as {
		domainId?: string;
		localPart?: string;
		label?: string;
		userId?: string;
	};

	if (!body.domainId || !body.localPart) {
		return json({ error: 'Pick a domain and enter an address' }, { status: 400 });
	}

	// Admins can provision addresses for other users; everyone else gets their own.
	const actorIsAdmin = Boolean(locals.user.is_admin);
	const userId = actorIsAdmin && body.userId ? body.userId : locals.user.id;

	try {
		const address = await getDomainsService(platform).createAddress({
			userId,
			domainId: body.domainId,
			localPart: body.localPart,
			label: body.label ?? null,
			actorIsAdmin
		});
		return json({ address }, { status: 201 });
	} catch (error) {
		if (error instanceof DomainsServiceError) {
			return json({ error: error.message, code: error.code }, { status: error.status });
		}
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to create address' },
			{ status: 400 }
		);
	}
};
