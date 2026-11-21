import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { loadMailboxPage } from '$lib/mail/mailbox-load';

export const load: PageLoad = async (event) => {
	const { url } = event;
	const archive = url.searchParams.get('view') === 'archive';
	// Zero's sidebar reaches Archive through `?view=archive` on the inbox route;
	// Classic links straight to /archive. Honour both so a link from either
	// shell lands in the right place.
	if (archive && (await event.parent()).uiTheme !== 'classic') {
		const next = new URL(url);
		next.pathname = '/archive';
		next.searchParams.delete('view');
		redirect(303, `${next.pathname}${next.search}`);
	}

	return loadMailboxPage(event, archive ? 'archive' : 'inbox');
};
