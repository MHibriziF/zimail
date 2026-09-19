import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mail-store/mailbox';
import { getCategoriesService } from '$lib/server/categories';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	// Zero's sidebar reaches Archive through `?view=archive` on the inbox route;
	// Classic links straight to /archive. Honour both so a link from either
	// shell lands in the right place.
	if (url.searchParams.get('view') === 'archive' && locals.uiTheme !== 'classic') {
		const next = new URL(url);
		next.pathname = '/archive';
		next.searchParams.delete('view');
		throw redirect(303, `${next.pathname}${next.search}`);
	}

	const view = url.searchParams.get('view') === 'archive' ? 'archive' : 'inbox';
	const tabs =
		view === 'inbox' && platform?.env.DB && locals.user
			? await getCategoriesService(platform).tabsEnabled(locals.user.id)
			: false;
	return loadMailbox(platform?.env.DB, locals.user?.id, view, url, locals.activeDomainId, { tabs });
};
