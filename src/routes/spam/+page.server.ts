import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mail-store/mailbox';

export const load: PageServerLoad = async ({ locals, platform, url }) =>
	loadMailbox(platform?.env.DB, locals.user?.id, 'spam', url, locals.activeDomainId);
