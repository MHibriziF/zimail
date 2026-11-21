import type { PageLoad } from './$types';
import { loadMailboxPage } from '$lib/mail/mailbox-load';

export const load: PageLoad = (event) => loadMailboxPage(event, 'trash');
