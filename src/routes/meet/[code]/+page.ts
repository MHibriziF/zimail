import type { PageLoad } from './$types';

// livekit-client is browser-only; keeping this page client-rendered keeps it
// out of the server bundle entirely, the same lesson learned from the
// import.meta.glob incident (wrangler's esbuild would otherwise see it).
export const ssr = false;

export const load: PageLoad = ({ params, data }) => {
	return {
		code: params.code,
		userName: data.userName,
		isLoggedIn: data.isLoggedIn,
		schedule: data.schedule
	};
};
