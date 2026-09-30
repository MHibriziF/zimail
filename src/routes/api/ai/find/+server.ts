import { json, type RequestHandler } from '@sveltejs/kit';
import { getAiService, MAX_QUESTION_CHARS, type HistoryTurn } from '$lib/server/ai';

type FindBody = { question?: unknown; history?: unknown; timeZone?: unknown };

const STATUS = { unavailable: 503, limit_reached: 429, not_found: 404, failed: 502 } as const;

function history(value: unknown): HistoryTurn[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(turn): turn is HistoryTurn =>
			(turn?.role === 'user' || turn?.role === 'assistant') && typeof turn?.content === 'string'
	);
}

/** Answers a question about the user's own mail. Session only: API tokens can't spend the daily AI allowance. */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user || locals.authMethod !== 'session') {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as FindBody;
	const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : '';
	if (!question) return json({ error: 'empty' }, { status: 400 });

	const outcome = await getAiService(platform).find(locals.user.id, {
		question,
		history: history(body.history),
		timeZone: typeof body.timeZone === 'string' ? body.timeZone : 'UTC'
	});
	if (outcome.kind === 'ok') return json({ answer: outcome.answer, messages: outcome.messages });
	return json({ error: outcome.kind }, { status: STATUS[outcome.kind] });
};
