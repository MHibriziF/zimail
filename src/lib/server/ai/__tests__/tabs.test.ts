import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AiBinding } from '../service';
import { TAB_CHUNK, TAB_MODEL, sortTabs, tabRequest, tabsFromResponse, type TabMessage } from '../tabs';

const message = (subject: string): TabMessage => ({ from: 'hello@notion.so', subject, body: 'Click to log in.' });

describe('tabRequest', () => {
	test('asks one tab question per message, about its own slot', () => {
		const request = tabRequest([message('a'), message('b')]) as {
			model: string;
			state: { mail: Record<string, { subject: string }> };
			questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }>;
		};
		assert.equal(request.model, 'clef-flash');
		assert.deepEqual(Object.keys(request.questions), ['m0', 'm1']);
		assert.equal(request.state.mail.m1.subject, 'b');
		assert.equal(request.questions.m1.type, 'choice');
		assert.match(request.questions.m1.instructions, /mail\.m1/);
		assert.deepEqual(Object.keys(request.questions.m1.criteria), ['primary', 'social', 'promotions', 'updates', 'forums']);
	});

	test('clips the body and drops empty headers', () => {
		const request = tabRequest([
			{ ...message('a'), body: 'x'.repeat(5_000), headers: { 'list-id': '<l.example>', precedence: null, 'list-post': ' ' } }
		]) as { state: { mail: { m0: { body: string; headers: Record<string, string> } } } };
		assert.equal(request.state.mail.m0.body.length, 2_000);
		assert.deepEqual(request.state.mail.m0.headers, { 'list-id': '<l.example>' });
	});
});

describe('tabsFromResponse', () => {
	test('reads each choice, and anything unusable as null', () => {
		const response = { answers: { m0: { type: 'choice', choice: 'primary' }, m1: { choice: 'spam' } } };
		assert.deepEqual(tabsFromResponse(response, 3), ['primary', null, null]);
		assert.deepEqual(tabsFromResponse(null, 1), [null]);
	});
});

describe('sortTabs', () => {
	test('splits into calls of TAB_CHUNK and keeps the order', async () => {
		const calls: number[] = [];
		const ai: AiBinding = {
			async run(model, inputs) {
				assert.equal(model, TAB_MODEL);
				const slots = Object.keys(inputs.questions as object);
				calls.push(slots.length);
				return { answers: Object.fromEntries(slots.map((slot) => [slot, { choice: 'updates' }])) };
			}
		};
		const outcome = await sortTabs(ai, Array.from({ length: TAB_CHUNK + 5 }, (_, index) => message(String(index))));
		assert.deepEqual(calls, [TAB_CHUNK, 5]);
		assert.equal(outcome.kind, 'sorted');
		assert.equal(outcome.kind === 'sorted' && outcome.tabs.length, TAB_CHUNK + 5);
	});

	test('reports the daily limit, and other failures, without throwing', async () => {
		const limited: AiBinding = { run: async () => Promise.reject(new Error('4006: daily free allocation exceeded')) };
		assert.deepEqual(await sortTabs(limited, [message('a')]), { kind: 'limit_reached' });

		const broken: AiBinding = { run: async () => Promise.reject(new Error('boom')) };
		const originalError = console.error;
		console.error = () => {};
		try {
			assert.deepEqual(await sortTabs(broken, [message('a')]), { kind: 'failed' });
		} finally {
			console.error = originalError;
		}
	});
});
