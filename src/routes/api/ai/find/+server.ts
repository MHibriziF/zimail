import { json, type RequestHandler } from '@sveltejs/kit';
import { getAiService, MAX_QUESTION_CHARS } from '$lib/server/ai';
import { getAiHistoryService, toHistory } from '$lib/server/ai-history';

type FindBody = { question?: unknown; conversationId?: unknown; timeZone?: unknown };

const STATUS = { unavailable: 503, limit_reached: 429, not_found: 404, failed: 502 } as const;

/**
 * Answers a question about the user's own mail and calendar, and saves it to the conversation
 * (`conversationId`, or a new one). Earlier turns come from the saved conversation, not the
 * browser. Session only: API tokens can't spend the daily AI allowance.
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as FindBody;
	const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : '';
	if (!question) return json({ error: 'empty' }, { status: 400 });

	const history = getAiHistoryService(platform);
	const conversation =
		typeof body.conversationId === 'string' ? await history.get(locals.user.id, body.conversationId) : null;

	const outcome = await getAiService(platform).find(locals.user.id, {
		question,
		history: conversation ? toHistory(conversation.turns) : [],
		timeZone: typeof body.timeZone === 'string' ? body.timeZone : 'UTC'
	});
	// A failed question isn't saved: there's nothing to come back to.
	if (outcome.kind !== 'ok') return json({ error: outcome.kind }, { status: STATUS[outcome.kind] });

	const conversationId = await history.append(locals.user.id, conversation, question, {
		content: outcome.answer,
		messages: outcome.messages,
		events: outcome.events
	});
	// Drafts aren't saved with the conversation: reopened later, an "Add" button could add it twice.
	return json({
		answer: outcome.answer,
		messages: outcome.messages,
		events: outcome.events,
		drafts: outcome.drafts,
		conversationId
	});
};
