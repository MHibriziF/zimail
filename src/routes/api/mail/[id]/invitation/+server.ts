import { json, type RequestHandler } from '@sveltejs/kit';
import { getMailStoreService } from '$lib/server/mail-store';
import { getInvitationsService } from '$lib/server/invitations';
import type { InvitationAction } from '$lib/server/invitations/service';

const ACTIONS: readonly InvitationAction[] = ['accepted', 'tentative', 'declined', 'add', 'remove'];

const FAILURES = {
	not_found: { error: 'This message has no invitation', status: 404 },
	outdated: { error: 'A newer version of this invitation has already been applied', status: 409 },
	unsupported: { error: 'That answer does not apply to this invitation', status: 400 }
} as const;

/** The calendar invitation carried by a message, for the card above its body. */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!(await getMailStoreService(platform).getEmailForUser(locals.user.id, params.id!))) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	const invitation = await getInvitationsService(platform).inspect(locals.user.id, params.id!);
	return json({ invitation });
};

/** Answers the invitation (and tells the organizer), or adds it to / takes it off the calendar. */
export const POST: RequestHandler = async ({ params, locals, platform, request }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!(await getMailStoreService(platform).getEmailForUser(locals.user.id, params.id!))) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = (await request.json().catch(() => ({}))) as { action?: unknown };
	const action = ACTIONS.find((entry) => entry === body.action);
	if (!action) return json({ error: 'Unknown action' }, { status: 400 });

	const outcome = await getInvitationsService(platform).act(locals.user.id, params.id!, action);
	if (outcome.type !== 'ok') {
		const failure = FAILURES[outcome.type];
		return json({ error: failure.error }, { status: failure.status });
	}
	return json({ invitation: outcome.view, replied: outcome.replied });
};
