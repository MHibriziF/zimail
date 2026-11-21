import type { PageServerLoad } from './$types';
import { getMailStoreService } from '$lib/server/mail-store';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const draftId = url.searchParams.get('draft');

	const draft =
		draftId && platform?.env.DB && locals.user
			? await getMailStoreService(platform).getDraft(locals.user.id, draftId)
			: null;

	return { addresses: locals.addresses, draft };
};
