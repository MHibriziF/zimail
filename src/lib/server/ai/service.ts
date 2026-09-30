import {
	composeMessages,
	parseComposeReply,
	plainTextToHtml,
	type ChatMessage,
	type ComposeRequest
} from './prompt';

/** The slice of the Workers AI binding this module uses. */
export type AiBinding = { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };

/**
 * Qwen3 30B (a mixture of experts, ~3B active): about the per-token price of Llama 3.1 8B,
 * and far steadier at following a format. ~10–25 neurons a draft against 10,000 free a day.
 */
export const COMPOSE_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const MAX_OUTPUT_TOKENS = 1024;

export type ReplySource = { from: string; subject: string; text: string };

export type ComposeInput = Omit<ComposeRequest, 'replyTo'> & { replyToId: string | null };

export type ComposeOutcome =
	| { kind: 'ok'; subject: string; html: string }
	/** No AI binding on this install. */
	| { kind: 'unavailable' }
	/** The free daily allowance is used up; it resets at 00:00 UTC. */
	| { kind: 'limit_reached' }
	| { kind: 'not_found' }
	| { kind: 'failed' };

export type AiService = {
	compose(userId: string, input: ComposeInput): Promise<ComposeOutcome>;
};

export type AiServiceDeps = {
	ai: AiBinding | null;
	loadReplySource(userId: string, emailId: string): Promise<ReplySource | null>;
};

/** Workers AI answers in its own shape or the OpenAI one depending on the model. */
export function responseText(result: unknown): string {
	if (typeof result === 'string') return result;
	const shaped = result as {
		response?: unknown;
		choices?: { message?: { content?: unknown } }[];
	} | null;
	const response = shaped?.response;
	if (typeof response === 'string') return response;
	if (response && typeof response === 'object') return JSON.stringify(response);
	const content = shaped?.choices?.[0]?.message?.content;
	return typeof content === 'string' ? content : '';
}

/** Error 4006 is Workers AI's "daily free allocation used up". */
export function isDailyLimitError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : JSON.stringify(error ?? '');
	return message.includes('4006') || message.toLowerCase().includes('daily free allocation');
}

export function createAiService(deps: AiServiceDeps): AiService {
	async function run(messages: ChatMessage[]): Promise<string> {
		const result = await deps.ai!.run(COMPOSE_MODEL, { messages, max_tokens: MAX_OUTPUT_TOKENS });
		return responseText(result);
	}

	return {
		async compose(userId, input) {
			if (!deps.ai) return { kind: 'unavailable' };
			let replyTo: ReplySource | null = null;
			if (input.replyToId) {
				replyTo = await deps.loadReplySource(userId, input.replyToId);
				if (!replyTo) return { kind: 'not_found' };
			}
			try {
				const reply = parseComposeReply(await run(composeMessages({ ...input, replyTo })));
				if (!reply) return { kind: 'failed' };
				return { kind: 'ok', subject: reply.subject, html: plainTextToHtml(reply.body) };
			} catch (error) {
				if (isDailyLimitError(error)) return { kind: 'limit_reached' };
				console.error('AI compose failed', error);
				return { kind: 'failed' };
			}
		}
	};
}
