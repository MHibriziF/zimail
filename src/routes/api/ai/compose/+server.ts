import { json, type RequestHandler } from '@sveltejs/kit';
import { COMPOSE_ACTIONS, getAiService, type ComposeAction } from '$lib/server/ai';

type ComposeBody = {
	action?: string;
	instruction?: string;
	draft?: string;
	subject?: string;
	replyToId?: string | null;
};

const STATUS = { unavailable: 503, limit_reached: 429, not_found: 404, failed: 502 } as const;

function isAction(value: unknown): value is ComposeAction {
	return COMPOSE_ACTIONS.includes(value as ComposeAction);
}

/** Drafts or rewrites an email. Session only: API tokens can't spend the daily AI allowance. */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as ComposeBody;
	if (!isAction(body.action)) return json({ error: 'invalid_action' }, { status: 400 });
	const instruction = body.instruction?.trim() ?? '';
	const draft = body.draft?.trim() ?? '';
	// A reply can be suggested from the message alone; anything else needs something to go on.
	if (!instruction && !draft && !body.replyToId) return json({ error: 'empty' }, { status: 400 });

	const outcome = await getAiService(platform).compose(locals.user.id, {
		action: body.action,
		instruction,
		draft,
		subject: body.subject ?? '',
		replyToId: body.replyToId || null,
		language: locals.locale
	});
	if (outcome.kind === 'ok') return json({ subject: outcome.subject, html: outcome.html });
	return json({ error: outcome.kind }, { status: STATUS[outcome.kind] });
};
