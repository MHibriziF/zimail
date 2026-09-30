import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeMessages, MAX_REPLY_SOURCE_CHARS, parseComposeReply, plainTextToHtml, type ComposeRequest } from '../prompt';
import { createAiService, isDailyLimitError, responseText, type AiBinding, type ReplySource } from '../service';

const request = (overrides: Partial<ComposeRequest> = {}): ComposeRequest => ({
	action: 'write',
	instruction: "say I'll be late",
	draft: '',
	subject: '',
	replyTo: null,
	language: 'en',
	...overrides
});

test('the prompt carries the task, draft and instruction, and asks Qwen3 to skip reasoning', () => {
	const [system, user] = composeMessages(request({ action: 'shorter', draft: 'Long draft', instruction: '' }));
	assert.equal(system.role, 'system');
	assert.match(system.content, /JSON only/);
	assert.match(user.content, /noticeably shorter/);
	assert.match(user.content, /<draft>\nLong draft\n<\/draft>/);
	assert.doesNotMatch(user.content, /<instruction>/);
	assert.ok(user.content.endsWith('/no_think'));
});

test('a reply includes the message being answered, clipped so it cannot eat the allowance', () => {
	const text = 'x'.repeat(MAX_REPLY_SOURCE_CHARS + 500);
	const [, user] = composeMessages(request({ replyTo: { from: 'Budi <budi@example.com>', subject: 'Say "hi"', text } }));
	assert.match(user.content, /reply to the message below from Budi <budi@example.com>/);
	assert.match(user.content, /subject="Say 'hi'"/);
	assert.ok(user.content.length < text.length);
});

test('the answer is read from JSON even with a reasoning block or code fence around it', () => {
	assert.deepEqual(parseComposeReply('<think>hmm {no}</think>```json\n{"subject":"Late","body":"Hi,\\n\\nRunning late."}\n```'), {
		subject: 'Late',
		body: 'Hi,\n\nRunning late.'
	});
	assert.equal(parseComposeReply('Sorry, I cannot help.'), null);
	assert.equal(parseComposeReply('{"subject":"x","body":"  "}'), null);
	assert.equal(parseComposeReply('{broken'), null);
});

test('plain text becomes escaped paragraphs', () => {
	assert.equal(plainTextToHtml('Hi <b>,\r\n\r\nLine one\nline two\n\n\n'), '<p>Hi &lt;b&gt;,</p><p>Line one<br>line two</p>');
});

test('both Workers AI response shapes are understood', () => {
	assert.equal(responseText({ response: 'a' }), 'a');
	assert.equal(responseText({ choices: [{ message: { content: 'b' } }] }), 'b');
	assert.equal(responseText({ response: { body: 'c' } }), '{"body":"c"}');
	assert.equal(responseText(null), '');
});

test('only the daily allowance error counts as the limit', () => {
	assert.ok(isDailyLimitError(new Error('4006: you have used up your daily free allocation of 10,000 neurons')));
	assert.ok(!isDailyLimitError(new Error('3040: capacity temporarily exceeded')));
});

function service(ai: AiBinding | null, source: ReplySource | null = null) {
	return createAiService({ ai, loadReplySource: async () => source });
}

const answering = (text: string): AiBinding => ({ run: async () => ({ response: text }) });

test('compose returns the draft as HTML', async () => {
	const outcome = await service(answering('{"subject":"Late","body":"Running late."}')).compose('u1', {
		...request(),
		replyToId: null
	});
	assert.deepEqual(outcome, { kind: 'ok', subject: 'Late', html: '<p>Running late.</p>' });
});

test('compose reports why it could not help', async () => {
	const input = { ...request(), replyToId: null };
	assert.deepEqual(await service(null).compose('u1', input), { kind: 'unavailable' });
	assert.deepEqual(await service(answering('no json')).compose('u1', input), { kind: 'failed' });
	const exhausted: AiBinding = { run: async () => Promise.reject(new Error('4006: daily free allocation')) };
	assert.deepEqual(await service(exhausted).compose('u1', input), { kind: 'limit_reached' });
	assert.deepEqual(await service(answering('{}')).compose('u1', { ...input, replyToId: 'someone-elses' }), {
		kind: 'not_found'
	});
});
