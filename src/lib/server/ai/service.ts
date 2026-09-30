import {
	composeMessages,
	parseComposeReply,
	plainTextToHtml,
	type ChatMessage,
	type ComposeRequest
} from './prompt';
import {
	FIND_TOOLS,
	findMessages,
	messageForModel,
	pickCards,
	plainAnswer,
	searchArgs,
	SEARCH_LIMIT,
	searchResultForModel,
	toolCalls,
	widenings,
	validTimeZone,
	type FoundMessage,
	type HistoryTurn,
	type LastSearch,
	type MessageDetail,
	type SearchArgs,
	type ToolCall
} from './find';

/** The slice of the Workers AI binding this module uses. */
export type AiBinding = { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };

/**
 * Qwen3 30B (a mixture of experts, ~3B active): about the per-token price of Llama 3.1 8B,
 * far steadier at following a format, and it calls tools. A draft costs ~5–25 neurons and a
 * search step ~3, against 10,000 free a day.
 */
export const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const MAX_OUTPUT_TOKENS = 1024;
/** Model turns per question: up to three rounds of tools, then an answer. */
const MAX_FIND_STEPS = 4;
const MAX_CALLS_PER_STEP = 3;
const MAX_CARDS = 5;

export type ComposeInput = Omit<ComposeRequest, 'replyTo'> & { replyToId: string | null };

type Failure =
	/** No AI binding on this install. */
	| { kind: 'unavailable' }
	/** The free daily allowance is used up; it resets at 00:00 UTC. */
	| { kind: 'limit_reached' }
	| { kind: 'not_found' }
	| { kind: 'failed' };

export type ComposeOutcome = { kind: 'ok'; subject: string; html: string } | Failure;

export type FindInput = { question: string; history: HistoryTurn[]; timeZone: string };
export type FindOutcome = { kind: 'ok'; answer: string; messages: FoundMessage[] } | Failure;

export type AiService = {
	compose(userId: string, input: ComposeInput): Promise<ComposeOutcome>;
	find(userId: string, input: FindInput): Promise<FindOutcome>;
};

export type AiServiceDeps = {
	ai: AiBinding | null;
	searchMail(userId: string, args: SearchArgs, limit: number): Promise<FoundMessage[]>;
	readMessage(userId: string, emailId: string): Promise<MessageDetail | null>;
	now?: () => Date;
};

type AgentMessage =
	| ChatMessage
	| { role: 'assistant'; content: string; tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
	| { role: 'tool'; tool_call_id: string; content: string };

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

function failure(error: unknown, what: string): Failure {
	if (isDailyLimitError(error)) return { kind: 'limit_reached' };
	console.error(`AI ${what} failed`, error);
	return { kind: 'failed' };
}

export function createAiService(deps: AiServiceDeps): AiService {
	const ai = () => deps.ai as AiBinding;

	/** Runs one tool call; returns what the model sees and what the panel may show. */
	async function runTool(userId: string, call: ToolCall, timeZone: string) {
		if (call.name === 'search_mail') {
			for (const { args, note } of widenings(searchArgs(call.args))) {
				const found = await deps.searchMail(userId, args, SEARCH_LIMIT);
				if (found.length > 0) {
					return { forModel: searchResultForModel(found, timeZone, note), found, loose: note !== null, read: [] };
				}
			}
			return { forModel: searchResultForModel([], timeZone), found: [], loose: false, read: [] };
		}
		if (call.name === 'read_message') {
			const id = typeof call.args.id === 'string' ? call.args.id : '';
			const message = id ? await deps.readMessage(userId, id) : null;
			return { forModel: messageForModel(message, timeZone), found: [], loose: false, read: message ? [message] : [] };
		}
		return { forModel: { error: `Unknown tool ${call.name}` }, found: [], loose: false, read: [] };
	}

	async function find(userId: string, input: FindInput): Promise<FindOutcome> {
		const timeZone = validTimeZone(input.timeZone);
		const messages: AgentMessage[] = findMessages({
			question: input.question,
			history: input.history,
			timeZone,
			now: deps.now?.() ?? new Date()
		});
		const read = new Map<string, FoundMessage>();
		let lastSearch: LastSearch = { found: [], loose: false };

		for (let step = 0; step < MAX_FIND_STEPS; step++) {
			// The last turn gets no tools, so the model has to answer with what it has.
			const tools = step < MAX_FIND_STEPS - 1 ? FIND_TOOLS : undefined;
			// Without this the model sometimes answers from nothing ("I can't see your mail").
			const toolChoice = step === 0 ? 'required' : undefined;
			const result = await ai().run(MODEL, {
				messages,
				tools,
				tool_choice: toolChoice,
				max_tokens: MAX_OUTPUT_TOKENS
			});
			const calls = tools ? toolCalls(result).slice(0, MAX_CALLS_PER_STEP) : [];
			if (calls.length === 0) {
				const answer = plainAnswer(responseText(result));
				if (!answer) return { kind: 'failed' };
				return { kind: 'ok', answer, messages: pickCards([...read.values()], lastSearch, answer).slice(0, MAX_CARDS) };
			}
			messages.push({
				role: 'assistant',
				content: '',
				tool_calls: calls.map((call) => ({
					id: call.id,
					type: 'function',
					function: { name: call.name, arguments: JSON.stringify(call.args) }
				}))
			});
			for (const call of calls) {
				const outcome = await runTool(userId, call, timeZone);
				if (outcome.found.length > 0) lastSearch = { found: outcome.found, loose: outcome.loose };
				for (const message of outcome.read) read.set(message.id, message);
				messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.forModel) });
			}
		}
		return { kind: 'failed' };
	}

	return {
		async compose(userId, input) {
			if (!deps.ai) return { kind: 'unavailable' };
			let replyTo: ComposeRequest['replyTo'] = null;
			if (input.replyToId) {
				const message = await deps.readMessage(userId, input.replyToId);
				if (!message) return { kind: 'not_found' };
				replyTo = { from: message.from, subject: message.subject, text: message.text };
			}
			try {
				const result = await ai().run(MODEL, {
					messages: composeMessages({ ...input, replyTo }),
					max_tokens: MAX_OUTPUT_TOKENS
				});
				const reply = parseComposeReply(responseText(result));
				if (!reply) return { kind: 'failed' };
				return { kind: 'ok', subject: reply.subject, html: plainTextToHtml(reply.body) };
			} catch (error) {
				return failure(error, 'compose');
			}
		},

		async find(userId, input) {
			if (!deps.ai) return { kind: 'unavailable' };
			try {
				return await find(userId, input);
			} catch (error) {
				return failure(error, 'find');
			}
		}
	};
}
