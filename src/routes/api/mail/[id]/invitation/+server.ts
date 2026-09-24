import { json, type RequestHandler } from '@sveltejs/kit';
import { getMailStoreService } from '$lib/server/mail-store';
import { getAnswersService, getInvitationsService } from '$lib/server/invitations';
import type { AnswerAction, InvitationAction } from '$lib/calendar/invitations';

const INVITATION_ACTIONS: readonly InvitationAction[] = ['accepted', 'tentative', 'declined', 'add', 'remove'];
const ANSWER_ACTIONS: readonly AnswerAction[] = ['accept-proposal', 'decline-proposal'];

const FAILURES = {
	not_found: { error: 'This message has no invitation', status: 404 },
	outdated: { error: 'A newer version of this invitation has already been applied', status: 409 },
	unsupported: { error: 'That answer does not apply to this invitation', status: 400 },
	slot_taken: { error: 'Another booking already has that time', status: 409 },
	not_sent: { error: 'Could not send your answer to the guest. Nothing changed; try again.', status: 502 }
} as const;

function failure(type: keyof typeof FAILURES) {
	return json({ error: FAILURES[type].error }, { status: FAILURES[type].status });
}

/**
 * The calendar part a message carries, for the card above its body: an
 * invitation to the user, or a guest's answer to one the user sent.
 */
export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!(await getMailStoreService(platform).getEmailForUser(locals.user.id, params.id!))) {
		return json({ error: 'Not found' }, { status: 404 });
	}
	const answer = await getAnswersService(platform).inspect(locals.user.id, params.id!);
	const invitation = answer ? null : await getInvitationsService(platform).inspect(locals.user.id, params.id!);
	return json({ invitation, answer });
};

/** Answers or adds/removes an invitation, or accepts/declines a guest's proposed time. */
export const POST: RequestHandler = async ({ params, locals, platform, request }) => {
	if (!platform?.env.DB || !locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	if (!(await getMailStoreService(platform).getEmailForUser(locals.user.id, params.id!))) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = (await request.json().catch(() => ({}))) as { action?: unknown };
	const answerAction = ANSWER_ACTIONS.find((entry) => entry === body.action);
	if (answerAction) {
		const outcome = await getAnswersService(platform).act(locals.user.id, params.id!, answerAction);
		return outcome.type === 'ok' ? json({ answer: outcome.answer }) : failure(outcome.type);
	}

	const action = INVITATION_ACTIONS.find((entry) => entry === body.action);
	if (!action) return json({ error: 'Unknown action' }, { status: 400 });
	const outcome = await getInvitationsService(platform).act(locals.user.id, params.id!, action);
	if (outcome.type !== 'ok') return failure(outcome.type);
	return json({ invitation: outcome.view, replied: outcome.replied });
};
