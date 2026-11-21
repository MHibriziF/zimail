import type { PageLoad } from './$types';
import { loadMailboxPage } from '$lib/mail/mailbox-load';

/** Everything that isn't trashed — where a label in the sidebar leads (`/all?label=…`). */
export const load: PageLoad = (event) => loadMailboxPage(event, 'all');
