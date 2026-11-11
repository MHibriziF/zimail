import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createOpenAiCompatible } from '../openai-compatible';
import { aiFromEnv } from '../provider';
import { isDailyLimitError, type AiBinding } from '../service';
import { TAB_MODEL, tabRequest, tabsFromResponse } from '../tabs';
import { CAPTION_MODEL } from '../transcribe';
import { createWorkersAiRest } from '../workers-ai-rest';

type Sent = { url: string; init: RequestInit };

function fakeFetch(respond: (sent: Sent) => Response): { fetch: typeof fetch; sent: Sent[] } {
	const sent: Sent[] = [];
	return {
		sent,
		fetch: (async (url: string | URL | Request, init: RequestInit = {}) => {
			const entry = { url: String(url), init };
			sent.push(entry);
			return respond(entry);
		}) as typeof fetch
	};
}

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function quietly<T>(run: () => T): T {
	const original = console.error;
	console.error = () => {};
	try {
		return run();
	} finally {
		console.error = original;
	}
}

describe('aiFromEnv', () => {
	const binding: AiBinding = { run: async () => null };

	test('the Workers AI binding by default, as before', () => {
		assert.equal(aiFromEnv({ AI: binding }), binding);
		assert.equal(aiFromEnv({ AI: binding, AI_PROVIDER: 'workers-ai' }), binding);
		assert.equal(aiFromEnv({}), null);
		assert.equal(aiFromEnv(undefined), null);
	});

	test('none switches AI off even when the binding exists', () => {
		assert.equal(aiFromEnv({ AI: binding, AI_PROVIDER: 'none' }), null);
	});

	test('builds the REST and OpenAI-compatible adapters only when fully configured', () => {
		quietly(() => {
			assert.equal(aiFromEnv({ AI_PROVIDER: 'workers-ai-rest', CLOUDFLARE_ACCOUNT_ID: 'acc' }), null);
			assert.notEqual(aiFromEnv({ AI_PROVIDER: 'workers-ai-rest', CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_AI_TOKEN: 't' }), null);
			assert.equal(aiFromEnv({ AI_PROVIDER: 'openai', AI_BASE_URL: 'http://localhost:11434/v1' }), null);
			assert.notEqual(aiFromEnv({ AI_PROVIDER: 'OpenAI', AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'qwen3' }), null);
			assert.equal(aiFromEnv({ AI: binding, AI_PROVIDER: 'mystery' }), null);
		});
	});
});

describe('createWorkersAiRest', () => {
	test('posts the inputs to the model on the account and returns the result', async () => {
		const { fetch, sent } = fakeFetch(() => jsonResponse({ success: true, result: { response: 'hi' } }));
		const ai = createWorkersAiRest({ accountId: 'acc 1', token: 'secret', fetch });

		assert.deepEqual(await ai.run('@cf/qwen/qwen3-30b-a3b-fp8', { messages: [] }), { response: 'hi' });
		assert.equal(sent[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc%201/ai/run/@cf/qwen/qwen3-30b-a3b-fp8');
		assert.equal((sent[0].init.headers as Record<string, string>).Authorization, 'Bearer secret');
		assert.deepEqual(JSON.parse(String(sent[0].init.body)), { messages: [] });
	});

	test('keeps the error code, so the daily limit is still recognised', async () => {
		const { fetch } = fakeFetch(() =>
			jsonResponse({ success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation' }] }, 429)
		);
		const ai = createWorkersAiRest({ accountId: 'acc', token: 't', fetch });
		const error = await ai.run('m', {}).catch((caught: unknown) => caught);
		assert.ok(error instanceof Error);
		assert.equal(isDailyLimitError(error), true);
	});
});

describe('createOpenAiCompatible', () => {
	test('chat requests pass through with the configured model, minus unset fields', async () => {
		const reply = { choices: [{ message: { content: 'ok' } }] };
		const { fetch, sent } = fakeFetch(() => jsonResponse(reply));
		const ai = createOpenAiCompatible({ baseUrl: 'http://localhost:11434/v1/', model: 'qwen3:30b', apiKey: 'k', fetch });

		const tools = [{ type: 'function', function: { name: 'search_mail' } }];
		const result = await ai.run('@cf/qwen/qwen3-30b-a3b-fp8', {
			messages: [{ role: 'user', content: 'hi' }],
			tools,
			tool_choice: 'required',
			temperature: undefined
		});

		assert.deepEqual(result, reply);
		assert.equal(sent[0].url, 'http://localhost:11434/v1/chat/completions');
		assert.equal((sent[0].init.headers as Record<string, string>).Authorization, 'Bearer k');
		assert.deepEqual(JSON.parse(String(sent[0].init.body)), {
			messages: [{ role: 'user', content: 'hi' }],
			tools,
			tool_choice: 'required',
			model: 'qwen3:30b'
		});
	});

	test('no key means no Authorization header, as Ollama expects', async () => {
		const { fetch, sent } = fakeFetch(() => jsonResponse({ choices: [] }));
		await createOpenAiCompatible({ baseUrl: 'http://ollama:11434/v1', model: 'm', fetch }).run('x', {});
		assert.equal((sent[0].init.headers as Record<string, string>).Authorization, undefined);
	});

	test('a non-2xx answer is an error carrying the status', async () => {
		const { fetch } = fakeFetch(() => new Response('model not found', { status: 404 }));
		const ai = createOpenAiCompatible({ baseUrl: 'http://ollama/v1', model: 'm', fetch });
		await assert.rejects(ai.run('x', {}), /404: model not found/);
	});

	test('Clef requests become a JSON chat, read back into tabs', async () => {
		const answer = '<think>hmm</think>Sure: ```json\n{"m0": "Promotions", "m1": "updates", "m2": 7}\n```';
		const { fetch, sent } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: answer } }] }));
		const ai = createOpenAiCompatible({ baseUrl: 'http://ollama/v1', model: 'm', fetch });

		const messages = [
			{ from: 'deals@shop.test', subject: '50% off' },
			{ from: 'noreply@bank.test', subject: 'Statement' },
			{ from: 'ada@example.com', subject: 'Lunch?' }
		];
		const response = await ai.run(TAB_MODEL, tabRequest(messages));
		assert.deepEqual(tabsFromResponse(response, 3), ['promotions', 'updates', null]);

		const body = JSON.parse(String(sent[0].init.body)) as { messages: { content: string }[]; temperature: number };
		assert.match(body.messages[0].content, /primary, social, promotions, updates, forums/);
		assert.match(body.messages[1].content, /50% off/);
		assert.equal(body.temperature, 0);
	});

	test('an unreadable Clef answer leaves every message to the header rules', async () => {
		const { fetch } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: 'I think promotions' } }] }));
		const ai = createOpenAiCompatible({ baseUrl: 'http://ollama/v1', model: 'm', fetch });
		const response = await ai.run(TAB_MODEL, tabRequest([{ from: 'a@b.test', subject: 'x' }]));
		assert.deepEqual(tabsFromResponse(response, 1), [null]);
	});

	test('captions go to /audio/transcriptions when a transcription model is set', async () => {
		const { fetch, sent } = fakeFetch(() => jsonResponse({ text: 'hello there' }));
		const ai = createOpenAiCompatible({ baseUrl: 'http://whisper/v1', model: 'm', transcriptionModel: 'whisper-1', fetch });

		const result = await ai.run(CAPTION_MODEL, { audio: btoa('RIFF'), language: 'en', vad_filter: true });
		assert.deepEqual(result, { text: 'hello there' });
		assert.equal(sent[0].url, 'http://whisper/v1/audio/transcriptions');
		const form = sent[0].init.body as FormData;
		assert.equal(form.get('model'), 'whisper-1');
		assert.equal(form.get('language'), 'en');
		assert.equal(await (form.get('file') as Blob).text(), 'RIFF');
	});

	test('caption audio may also come as bytes', async () => {
		const { fetch, sent } = fakeFetch(() => jsonResponse({ text: '' }));
		const ai = createOpenAiCompatible({ baseUrl: 'http://whisper/v1', model: 'm', transcriptionModel: 'whisper-1', fetch });
		await ai.run(CAPTION_MODEL, { audio: new TextEncoder().encode('RIFF') });
		assert.equal(await ((sent[0].init.body as FormData).get('file') as Blob).text(), 'RIFF');
	});

	test('captions fail clearly without a transcription model', async () => {
		const { fetch, sent } = fakeFetch(() => jsonResponse({}));
		const ai = createOpenAiCompatible({ baseUrl: 'http://ollama/v1', model: 'm', fetch });
		await assert.rejects(ai.run(CAPTION_MODEL, { audio: '' }), /AI_TRANSCRIPTION_MODEL/);
		assert.equal(sent.length, 0);
	});
});
