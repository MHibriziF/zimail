import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mail-store/mailbox';

/** Everything that isn't trashed — where a label in the sidebar leads (`/all?label=…`). */
export const load: PageServerLoad = async ({ locals, platform, url }) =>
	loadMailbox(platform?.env.DB, locals.user?.id, 'all', url, locals.activeDomainId);
