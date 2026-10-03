import { addDays } from '$lib/calendar/events';
import {
	composeMessages,
	parseComposeReply,
	plainTextToHtml,
	type ChatMessage,
	type ComposeRequest
} from './prompt';
import {
	eventRange,
	eventsForModel,
	filterEvents,
	FIND_TOOLS,
	findMessages,
	localStamp,
	messageForModel,
	pickCards,
	plainAnswer,
	searchArgs,
	SEARCH_LIMIT,
	searchResultForModel,
	toolCalls,
	widenings,
	validTimeZone,
	type EventRange,
	type FoundEvent,
	type FoundMessage,
	type HistoryTurn,
	type LastSearch,
	type MessageDetail,
	type SearchArgs,
	type ToolCall
} from './find';
import { CREATE_EVENT_TOOL, draftForModel, eventDraft, withConflicts, type EventDraft } from './draft';

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
const FIND_TEMPERATURE = 0.1;
const MAX_CARDS = 5;
const MAX_DRAFTS = 3;
const ASK_TOOLS = [...FIND_TOOLS, CREATE_EVENT_TOOL];

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
export type FindOutcome =
	| { kind: 'ok'; answer: string; messages: FoundMessage[]; events: FoundEvent[]; drafts: EventDraft[] }
	| Failure;

export type AiService = {
	compose(userId: string, input: ComposeInput): Promise<ComposeOutcome>;
	find(userId: string, input: FindInput): Promise<FindOutcome>;
};

export type AiServiceDeps = {
	ai: AiBinding | null;
	searchMail(userId: string, args: SearchArgs, limit: number): Promise<FoundMessage[]>;
	readMessage(userId: string, emailId: string): Promise<MessageDetail | null>;
	/** Events overlapping the range's days in the reader's zone. */
	listEvents(userId: string, range: EventRange, timeZone: string): Promise<FoundEvent[]>;
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

	type FindRun = {
		userId: string;
		timeZone: string;
		/** `YYYY-MM-DD` in the reader's zone, the default start of a calendar lookup. */
		today: string;
		messages: AgentMessage[];
		read: Map<string, FoundMessage>;
		lastSearch: LastSearch;
		/** Every event any list_events call returned, by id: "Monday and Tuesday" is two calls. */
		events: Map<string, FoundEvent>;
		/** Events create_event prepared, by title and start: a retry replaces rather than repeats. */
		drafts: Map<string, EventDraft>;
	};

	/**
	 * Each tool records on the run what the panel may show, and returns what the model sees.
	 * An empty mail search is widened here, since the model rarely retries by itself.
	 */
	const tools: Record<string, (run: FindRun, args: Record<string, unknown>) => Promise<unknown>> = {
		async search_mail(run, raw) {
			for (const { args, note } of widenings(searchArgs(raw))) {
				const found = await deps.searchMail(run.userId, args, SEARCH_LIMIT);
				if (found.length > 0) {
					run.lastSearch = { found, loose: note !== null };
					return searchResultForModel(found, run.timeZone, note);
				}
			}
			return searchResultForModel([], run.timeZone);
		},
		async read_message(run, raw) {
			const id = typeof raw.id === 'string' ? raw.id : '';
			const message = id ? await deps.readMessage(run.userId, id) : null;
			if (message) run.read.set(message.id, message);
			return messageForModel(message, run.timeZone);
		},
		async list_events(run, raw) {
			const range = eventRange(raw, run.today);
			const { events, note } = filterEvents(await deps.listEvents(run.userId, range, run.timeZone), range);
			for (const event of events) run.events.set(event.id, event);
			return eventsForModel(events, range, run.timeZone, note);
		},
		/** Never writes: the draft goes to the panel, and only the user's click saves it. */
		async create_event(run, raw) {
			const prepared = eventDraft(raw, run.timeZone);
			if ('error' in prepared) return prepared;
			const day = { after: prepared.day, before: addDays(prepared.day, 1), text: null };
			const draft = withConflicts(prepared, await deps.listEvents(run.userId, day, run.timeZone), run.timeZone);
			run.drafts.set(`${draft.title}|${draft.start}`, draft);
			return draftForModel(draft, run.timeZone);
		}
	};

	async function runTool(run: FindRun, call: ToolCall): Promise<unknown> {
		const tool = Object.hasOwn(tools, call.name) ? tools[call.name] : null;
		return tool ? tool(run, call.args) : { error: `Unknown tool ${call.name}` };
	}

	/** Echoes the model's tool calls back into the conversation, each followed by its result. */
	async function runRound(run: FindRun, calls: ToolCall[]) {
		run.messages.push({
			role: 'assistant',
			content: '',
			tool_calls: calls.map((call) => ({
				id: call.id,
				type: 'function',
				function: { name: call.name, arguments: JSON.stringify(call.args) }
			}))
		});
		for (const call of calls) {
			const forModel = await runTool(run, call);
			run.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(forModel) });
		}
	}

	function finish(run: FindRun, result: unknown): FindOutcome {
		const answer = plainAnswer(responseText(result));
		if (!answer) return { kind: 'failed' };
		const cards = pickCards([...run.read.values()], run.lastSearch, answer);
		return {
			kind: 'ok',
			answer,
			messages: cards.slice(0, MAX_CARDS),
			events: [...run.events.values()].slice(0, MAX_CARDS),
			drafts: [...run.drafts.values()].slice(0, MAX_DRAFTS)
		};
	}

	async function find(userId: string, input: FindInput): Promise<FindOutcome> {
		const timeZone = validTimeZone(input.timeZone);
		const now = deps.now?.() ?? new Date();
		const run: FindRun = {
			userId,
			timeZone,
			today: localStamp(now.toISOString(), timeZone).split(' ')[1],
			messages: findMessages({ question: input.question, history: input.history, timeZone, now }),
			read: new Map(),
			lastSearch: { found: [], loose: false },
			events: new Map(),
			drafts: new Map()
		};

		for (let step = 0; step < MAX_FIND_STEPS; step++) {
			// The last turn gets no tools, so the model has to answer with what it has.
			const tools = step < MAX_FIND_STEPS - 1 ? ASK_TOOLS : undefined;
			const result = await ai().run(MODEL, {
				messages: run.messages,
				tools,
				// Without this the model sometimes answers from nothing ("I can't see your mail").
				tool_choice: step === 0 ? 'required' : undefined,
				// Looking things up wants the same answer every time, not variety.
				temperature: FIND_TEMPERATURE,
				max_tokens: MAX_OUTPUT_TOKENS
			});
			const calls = tools ? toolCalls(result).slice(0, MAX_CALLS_PER_STEP) : [];
			if (calls.length === 0) return finish(run, result);
			await runRound(run, calls);
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
