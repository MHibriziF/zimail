import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_RAW_MESSAGE_BYTES, parseHeaderBlock, readRawInbound, secretMatches } from '../raw-webhook';
import { asWebhookRequest, RAW_INBOUND_PATH } from '../webhook-request';

const SECRET = 's3cret-value';
const URL_ = `https://mail.example.test${RAW_INBOUND_PATH}`;
const MIME = [
	'Received: from mx.example.net',
	'From: Ada <ada@example.net>',
	'To: me@mine.test',
	'Subject: Hello',
	'Authentication-Results: mx.mine.test; spf=pass',
	' smtp.mailfrom=example.net',
	'Message-ID: <m1@example.net>',
	'',
	'Hi there'
].join('\r\n');

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
	return new Request(URL_, { method: 'POST', body, headers: { Authorization: `Bearer ${SECRET}`, ...headers } });
}

describe('readRawInbound', () => {
	test('a raw body with the envelope in headers, as a Postfix pipe sends it', async () => {
		const outcome = await readRawInbound(
			post(MIME, { 'Content-Type': 'message/rfc822', 'X-Envelope-To': 'me@mine.test', 'X-Envelope-From': 'bounce@example.net' }),
			SECRET
		);
		assert.equal(outcome.kind, 'message');
		if (outcome.kind !== 'message') return;
		assert.equal(outcome.message.to, 'me@mine.test');
		assert.equal(outcome.message.from, 'bounce@example.net');
		assert.equal(outcome.message.headers.get('subject'), 'Hello');
		assert.equal(outcome.message.headers.get('authentication-results'), 'mx.mine.test; spf=pass smtp.mailfrom=example.net');
		assert.equal(await new Response(outcome.message.raw).text(), MIME);
	});

	test('SendGrid raw mode: the message in `email`, the envelope as JSON', async () => {
		const form = new FormData();
		form.append('email', MIME);
		form.append('envelope', JSON.stringify({ from: 'bounce@example.net', to: ['me@mine.test', 'other@mine.test'] }));
		const outcome = await readRawInbound(post(form), SECRET);
		assert.equal(outcome.kind, 'message');
		if (outcome.kind !== 'message') return;
		assert.equal(outcome.message.to, 'me@mine.test');
		assert.equal(outcome.message.from, 'bounce@example.net');
		assert.equal(await new Response(outcome.message.raw).text(), MIME);
	});

	test('Mailgun MIME route: `body-mime` as a file, with `recipient` and `sender`', async () => {
		const form = new FormData();
		form.append('body-mime', new Blob([MIME], { type: 'message/rfc822' }), 'message.mime');
		form.append('recipient', 'me@mine.test');
		form.append('sender', 'bounce@example.net');
		const outcome = await readRawInbound(post(form), SECRET);
		assert.equal(outcome.kind, 'message');
		if (outcome.kind !== 'message') return;
		assert.equal(outcome.message.to, 'me@mine.test');
		assert.equal(await new Response(outcome.message.raw).text(), MIME);
	});

	test('the secret may come as the Basic password, for forwarders that only take a URL', async () => {
		const outcome = await readRawInbound(post(MIME, { Authorization: `Basic ${btoa(`zimail:${SECRET}`)}` }), SECRET);
		assert.equal(outcome.kind, 'message');
	});

	test('no secret, a wrong one, or one in the query string is refused', async () => {
		const missing = new Request(URL_, { method: 'POST', body: MIME });
		assert.equal((await readRawInbound(missing, SECRET)).kind, 'unauthorized');
		assert.equal((await readRawInbound(post(MIME, { Authorization: 'Bearer nope' }), SECRET)).kind, 'unauthorized');
		const inQuery = new Request(`${URL_}?token=${SECRET}`, { method: 'POST', body: MIME });
		assert.equal((await readRawInbound(inQuery, SECRET)).kind, 'unauthorized');
	});

	test('a body that is not a mail message, or no message field, is invalid', async () => {
		assert.equal((await readRawInbound(post('hello world'), SECRET)).kind, 'invalid');
		assert.equal((await readRawInbound(post(''), SECRET)).kind, 'invalid');
		const form = new FormData();
		form.append('text', 'parsed only');
		assert.equal((await readRawInbound(post(form), SECRET)).kind, 'invalid');
	});

	test('an oversized message is refused from its declared length, unread', async () => {
		const outcome = await readRawInbound(post(MIME, { 'Content-Length': String(MAX_RAW_MESSAGE_BYTES + 1) }), SECRET);
		assert.equal(outcome.kind, 'too_large');
	});
});

describe('secretMatches', () => {
	test('matches only the exact secret', async () => {
		assert.equal(await secretMatches(SECRET, SECRET), true);
		assert.equal(await secretMatches(`${SECRET} `, SECRET), false);
		assert.equal(await secretMatches('', SECRET), false);
	});
});

describe('parseHeaderBlock', () => {
	test('unfolds continuation lines and stops at the body', () => {
		const headers = parseHeaderBlock(new TextEncoder().encode('Subject: one\r\n two\r\nX-A: b\r\n\r\nSubject: not a header'));
		assert.equal(headers.get('subject'), 'one two');
		assert.equal(headers.get('x-a'), 'b');
	});

	test('keeps a field that carries raw UTF-8, instead of dropping it', () => {
		const headers = parseHeaderBlock(new TextEncoder().encode('Authentication-Results: mx.exämple.test; spf=pass 日本\r\n\r\n'));
		assert.equal(headers.get('authentication-results'), 'mx.exämple.test; spf=pass ??');
	});
});

describe('asWebhookRequest', () => {
	test('presents the inbound webhook as same-origin, without cookies', () => {
		const request = asWebhookRequest(
			new Request(URL_, { method: 'POST', body: 'x', headers: { Cookie: 'mail_session=abc', 'Content-Type': 'multipart/form-data; boundary=b' } })
		);
		assert.equal(request.headers.get('origin'), 'https://mail.example.test');
		assert.equal(request.headers.get('cookie'), null);
	});

	test('leaves every other request alone', () => {
		const other = new Request('https://mail.example.test/api/mail', { method: 'POST', body: 'x', headers: { Cookie: 'a=b' } });
		assert.equal(asWebhookRequest(other), other);
		const get = new Request(URL_);
		assert.equal(asWebhookRequest(get), get);
	});
});
