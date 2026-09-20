import type { PageServerLoad } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';
import { parseShowCount } from '$lib/meet/meetings-list';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const shown = parseShowCount(url.searchParams.get('show'));
	if (!locals.user || !platform?.env.DB) return { meetings: [], shown, hasMore: false };

	// One extra row answers "is there another page?" without a second COUNT query.
	const rows = await getMeetingsService(platform).list(locals.user.id, shown + 1);
	return { meetings: rows.slice(0, shown), shown, hasMore: rows.length > shown };
};
