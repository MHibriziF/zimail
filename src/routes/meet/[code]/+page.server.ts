import type { PageServerLoad } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';

// Even with ssr disabled below, a server load still runs once on the initial
// request — this is the only way to know who is visiting before the client
// takes over, so a signed-in host does not have to retype their own name.
export const load: PageServerLoad = async ({ locals, params, platform }) => {
	const meeting = platform?.env.DB ? await getMeetingsService(platform).findByCode(params.code).catch(() => null) : null;
	const schedule =
		meeting?.scheduled_start && meeting.scheduled_end ? { start: meeting.scheduled_start, end: meeting.scheduled_end } : null;
	return { userName: locals.user?.name ?? null, isLoggedIn: !!locals.user, schedule };
};
