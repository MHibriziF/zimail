import type { AiBinding } from './service';
import { TAB_MODEL } from './tabs';
import { CAPTION_MODEL } from './transcribe';

/**
 * Any OpenAI-compatible endpoint: Ollama, llama.cpp, vLLM, LM Studio, or a
 * hosted API the owner chose. Mail goes only to `baseUrl`, so this is never a
 * default; it runs only when it's configured.
 *
 * The app's chat requests are already OpenAI-shaped (messages, tools,
 * tool_choice), so they pass through with the configured model. The two
 * Cloudflare-only models are translated:
 * - Clef (inbox tabs) becomes a chat request that answers in JSON, read back
 *   into Clef's `answers` shape. A bad answer leaves that message to the header
 *   rules, as a Clef failure does.
 * - Whisper (meeting captions) goes to `/audio/transcriptions`, but only when a
 *   transcription model is set. Ollama doesn't serve one.
 */
export type OpenAiCompatibleOptions = {
	/** e.g. `http://localhost:11434/v1` for Ollama. */
	baseUrl: string;
	/** A tool-capable chat model, e.g. `qwen3:30b`. */
	model: string;
	apiKey?: string;
	/** e.g. `whisper-1` on an endpoint that serves `/audio/transcriptions`. */
	transcriptionModel?: string;
	fetch?: typeof fetch;
};

type Choice = { message?: { content?: unknown } };

function definedOnly(inputs: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== undefined));
}

function messageText(result: unknown): string {
	const content = (result as { choices?: Choice[] } | null)?.choices?.[0]?.message?.content;
	return typeof content === 'string' ? content.replaceAll(/<think>[\s\S]*?<\/think>/g, '') : '';
}

/** The first `{...}` in the reply; small models wrap JSON in prose or code fences. */
function firstJsonObject(text: string): Record<string, unknown> {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return {};
	try {
		const parsed: unknown = JSON.parse(text.slice(start, end + 1));
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

type ClefInputs = {
	state?: { mail?: Record<string, unknown> };
	questions?: Record<string, { criteria?: Record<string, string> }>;
};

export function tabsChatRequest(inputs: ClefInputs): { messages: { role: string; content: string }[] } {
	const mail = inputs.state?.mail ?? {};
	const criteria = Object.values(inputs.questions ?? {})[0]?.criteria ?? {};
	const tabs = Object.keys(criteria);
	const definitions = Object.entries(criteria)
		.map(([tab, rule]) => `- ${tab}: ${rule}`)
		.join('\n');
	return {
		messages: [
			{
				role: 'system',
				content: `Sort each email into one inbox tab.\n${definitions}\n\nReply with only a JSON object mapping each email's key to one of: ${tabs.join(', ')}. Example: {"m0": "${tabs[0] ?? 'primary'}"}`
			},
			{ role: 'user', content: JSON.stringify(mail) }
		]
	};
}

export function tabsFromChat(result: unknown, slots: string[]): { answers: Record<string, { choice: unknown }> } {
	const parsed = firstJsonObject(messageText(result));
	const answers: Record<string, { choice: unknown }> = {};
	for (const slot of slots) {
		const choice = parsed[slot];
		answers[slot] = { choice: typeof choice === 'string' ? choice.trim().toLowerCase() : null };
	}
	return { answers };
}

/** Workers AI takes the audio as base64; bytes are accepted too. */
function audioBytes(audio: unknown): Uint8Array<ArrayBuffer> {
	if (audio instanceof Uint8Array) return new Uint8Array(audio);
	if (audio instanceof ArrayBuffer) return new Uint8Array(audio.slice(0));
	const binary = atob(typeof audio === 'string' ? audio : '');
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.codePointAt(index) ?? 0;
	return bytes;
}

function withoutTrailingSlashes(url: string): string {
	let end = url.length;
	while (end > 0 && url[end - 1] === '/') end--;
	return url.slice(0, end);
}

export function createOpenAiCompatible(options: OpenAiCompatibleOptions): AiBinding {
	const base = withoutTrailingSlashes(options.baseUrl);
	const send = options.fetch ?? fetch;
	const auth: Record<string, string> = options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {};

	async function post(path: string, body: BodyInit, headers: Record<string, string> = {}): Promise<unknown> {
		const response = await send(base + path, { method: 'POST', headers: { ...auth, ...headers }, body });
		if (!response.ok) {
			const detail = (await response.text().catch(() => '')).slice(0, 300);
			const suffix = detail ? ': ' + detail : '';
			throw new Error(`AI endpoint returned ${response.status}${suffix}`);
		}
		return response.json();
	}

	const chat = (inputs: Record<string, unknown>) =>
		post('/chat/completions', JSON.stringify({ ...definedOnly(inputs), model: options.model }), {
			'Content-Type': 'application/json'
		});

	async function transcribe(inputs: Record<string, unknown>): Promise<unknown> {
		if (!options.transcriptionModel) throw new Error('No transcription model is configured (AI_TRANSCRIPTION_MODEL).');
		const form = new FormData();
		form.append('file', new Blob([audioBytes(inputs.audio)], { type: 'audio/wav' }), 'speech.wav');
		form.append('model', options.transcriptionModel);
		if (typeof inputs.language === 'string' && inputs.language) form.append('language', inputs.language);
		return post('/audio/transcriptions', form);
	}

	return {
		async run(model, inputs) {
			if (model === CAPTION_MODEL) return transcribe(inputs);
			if (model === TAB_MODEL) {
				const slots = Object.keys((inputs as ClefInputs).state?.mail ?? {});
				const result = await chat({ ...tabsChatRequest(inputs as ClefInputs), temperature: 0 });
				return tabsFromChat(result, slots);
			}
			return chat(inputs);
		}
	};
}
