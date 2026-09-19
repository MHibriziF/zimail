import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';

/**
 * Polled by a guest waiting to be let in. Public — the admission id is itself
 * the credential, same trust level as the join code. Mints the LiveKit token
 * right here once admitted, so the guest's poll loop doesn't need a second
 * round trip.
 */
export const GET: RequestHandler = async ({ params, url, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Database unavailable' }, { status: 503 });

	const name = url.searchParams.get('name')?.trim().slice(0, 100) || undefined;

	try {
		const outcome = await getMeetingsService(platform).checkAdmission(params.code, params.admissionId, name);

		if (outcome.type === 'meeting_not_found') {
			return json({ error: 'That code is invalid or the meeting no longer exists.' }, { status: 404 });
		}
		if (outcome.type === 'admission_not_found') {
			return json({ error: 'Admission request not found' }, { status: 404 });
		}
		if (outcome.type === 'waiting') {
			return json({ status: outcome.status });
		}
		return json({ status: 'admitted', url: outcome.url, token: outcome.token, roomName: outcome.roomName, screenShare: outcome.screenShare });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Could not join meeting' },
			{ status: 503 }
		);
	}
};
