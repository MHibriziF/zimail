import type { PageServerLoad } from './$types';
import { getCalendarService } from '$lib/server/calendar';
import { getMeetingsService } from '$lib/server/meet/meetings';
import { parseShowCount } from '$lib/meet/meetings-list';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const shown = parseShowCount(url.searchParams.get('show'));
	if (!locals.user || !platform?.env.DB) return { meetings: [], upcomingMeetings: [], shown, hasMore: false };

	// One extra row answers "is there another page?" without a second COUNT query.
	const [rows, upcomingMeetings] = await Promise.all([
		getMeetingsService(platform).list(locals.user.id, shown + 1),
		getCalendarService(platform, url.origin).upcomingMeetings(locals.user.id, new Date())
	]);
	return { meetings: rows.slice(0, shown), upcomingMeetings, shown, hasMore: rows.length > shown };
};
