import { json, type RequestHandler } from '@sveltejs/kit';
import {
	countSweepCandidates,
	getCleanupSettings,
	isSweepAgeChoice,
	purgeExpiredTrash,
	saveCleanupSettings,
	sweepOldMail,
	type SweepFilter
} from '$lib/server/cleanup';

function readFilter(body: Record<string, unknown>): SweepFilter | null {
	const days = Number(body.olderThanDays);
	if (!isSweepAgeChoice(days)) return null;

	return {
		olderThanDays: days,
		onlyRead: body.onlyRead !== false,
		keepStarred: body.keepStarred !== false
	};
}

/** Preview: how many messages a given filter would move. Changes nothing. */
export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const filter = readFilter({
		olderThanDays: url.searchParams.get('olderThanDays'),
		onlyRead: url.searchParams.get('onlyRead') !== '0',
		keepStarred: url.searchParams.get('keepStarred') !== '0'
	});

	const settings = await getCleanupSettings(db, locals.user.id);
	if (!filter) return json({ ...settings, count: null });

	return json({ ...settings, count: await countSweepCandidates(db, locals.user.id, filter) });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: 'Invalid request' }, { status: 400 });
	}

	try {
		// The whole form, saved by its Save button: retention plus the sweep and whether it runs daily.
		if (body.action === 'settings') {
			const sweep = readFilter((body.sweep ?? {}) as Record<string, unknown>);
			if (!sweep) return json({ error: 'Pick an age to sweep' }, { status: 400 });
			await saveCleanupSettings(db, locals.user.id, {
				trashRetentionDays: Number(body.trashRetentionDays),
				sweep: { ...sweep, auto: (body.sweep as { auto?: unknown }).auto === true }
			});
			return json({ ok: true, ...(await getCleanupSettings(db, locals.user.id)) });
		}

		if (body.action === 'empty-expired') {
			const { trashRetentionDays } = await getCleanupSettings(db, locals.user.id);
			const removed = await purgeExpiredTrash(
				db,
				platform?.env.ATTACHMENTS,
				locals.user.id,
				trashRetentionDays
			);
			return json({ ok: true, removed });
		}

		// The one-off: move now with whatever filter is on screen, saved or not.
		if (body.action === 'sweep') {
			const filter = readFilter(body);
			if (!filter) return json({ error: 'Pick an age to sweep' }, { status: 400 });

			const moved = await sweepOldMail(db, locals.user.id, filter);
			return json({ ok: true, moved });
		}

		return json({ error: 'Unknown action' }, { status: 400 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Cleanup failed' },
			{ status: 400 }
		);
	}
};
