import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fromRawMime, inboundSender } from '../raw-mime';
import { parseHeaderBlock } from '../raw-webhook';

describe('inboundSender', () => {
	test('prefers the From: header over the bounce envelope sender', () => {
		// Cloudflare Email Sending puts bounces@cf-bounce.<domain> in MAIL FROM, so
		// mail between two addresses on the same instance arrives with an envelope
		// sender that is not the author. Taking it would mis-attribute the message
		// and point replies at the bounce mailbox.
		assert.equal(
			inboundSender('alice@example.com', 'bounces@cf-bounce.example.com'),
			'alice@example.com'
		);
	});

	test('falls back to the envelope sender when there is no From: header', () => {
		assert.equal(inboundSender(undefined, 'someone@example.com'), 'someone@example.com');
		assert.equal(inboundSender('', 'someone@example.com'), 'someone@example.com');
	});

	test('falls back when the From: header yields no address', () => {
		// Blank and malformed headers are still truthy strings, so the choice has
		// to turn on whether an address came out of them.
		assert.equal(inboundSender('   ', 'someone@example.com'), 'someone@example.com');
		assert.equal(inboundSender('<>', 'someone@example.com'), 'someone@example.com');
		assert.equal(
			inboundSender('undisclosed-recipients', 'someone@example.com'),
			'someone@example.com'
		);
	});

	test('unwraps a display name', () => {
		assert.equal(inboundSender('Grace Hopper <grace@example.com>', ''), 'grace@example.com');
	});

	test('normalises case', () => {
		assert.equal(inboundSender('Grace@Example.COM', ''), 'grace@example.com');
	});

	test('returns an empty string when neither is present', () => {
		assert.equal(inboundSender(undefined, undefined), '');
	});
});

function mime(headers: Record<string, string>, body = 'Hi there'): ArrayBuffer {
	const text = [...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), '', body].join('\r\n');
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

async function parse(headers: Record<string, string>, envelope: { from?: string; to?: string } = {}, body?: string) {
	const raw = mime(headers, body);
	return fromRawMime(raw, {
		from: envelope.from ?? 'bounces@example.net',
		to: envelope.to ?? 'me@mine.test',
		headers: parseHeaderBlock(new Uint8Array(raw))
	});
}

const HEADERS = {
	From: 'Ada <ada@example.net>',
	To: 'Me <me@mine.test>, Other <other@mine.test>',
	Cc: 'bob@example.org',
	Subject: 'Hello',
	'Message-ID': '<m1@example.net>',
	Date: 'Tue, 10 Nov 2026 10:00:00 +0000'
};

describe('fromRawMime', () => {
	test('the Message-ID is the provider id', async () => {
		assert.equal((await parse(HEADERS)).providerId, 'm1@example.net');
	});

	test('without a Message-ID the id is a stable hash of sender, recipient and date', async () => {
		const { 'Message-ID': _omitted, ...headers } = HEADERS;
		const first = await parse(headers);
		const second = await parse(headers);
		assert.match(first.providerId, /^cf-[0-9a-f]{32}$/);
		assert.equal(second.providerId, first.providerId);
		assert.notEqual((await parse({ ...headers, Date: 'Wed, 11 Nov 2026 10:00:00 +0000' })).providerId, first.providerId);
	});

	test('the envelope recipient comes first, then the addressed ones', async () => {
		const message = await (await parse(HEADERS, { to: 'alias@mine.test' })).read();
		assert.deepEqual(message.recipients, ['alias@mine.test', 'me@mine.test', 'other@mine.test', 'bob@example.org']);
		assert.equal(message.envelopeTo, 'alias@mine.test');
		assert.deepEqual(message.cc, ['bob@example.org']);
	});

	test('the author is the From: header, not the bounce envelope', async () => {
		const message = await (await parse(HEADERS)).read();
		assert.equal(message.from, 'ada@example.net');
		assert.equal(message.fromName, 'Ada');
	});

	test('threading ids lose their angle brackets; the References chain is kept whole', async () => {
		const message = await (
			await parse({ ...HEADERS, 'In-Reply-To': '<parent@example.net>', References: '<root@example.net> <parent@example.net>' })
		).read();
		assert.equal(message.messageId, 'm1@example.net');
		assert.equal(message.inReplyTo, 'parent@example.net');
		assert.equal(message.references, '<root@example.net> <parent@example.net>');
	});

	test('headers the parser does not model are read from the header block', async () => {
		const message = await (await parse({ ...HEADERS, 'Authentication-Results': 'mx; spf=pass' })).read();
		assert.equal(message.header('authentication-results'), 'mx; spf=pass');
	});

	test('attachments carry their bytes; an empty part counts as never delivered', async () => {
		const body = [
			'--b',
			'Content-Type: text/plain',
			'',
			'Hi',
			'--b',
			'Content-Type: text/plain; name="notes.txt"',
			'Content-Disposition: attachment; filename="notes.txt"',
			'',
			'Notes',
			'--b',
			'Content-Type: application/octet-stream; name="empty.bin"',
			'Content-Disposition: attachment; filename="empty.bin"',
			'',
			'',
			'--b--'
		].join('\r\n');
		const message = await (
			await parse({ ...HEADERS, 'MIME-Version': '1.0', 'Content-Type': 'multipart/mixed; boundary="b"' }, {}, body)
		).read();
		const attachments = await message.attachments();

		assert.deepEqual(
			attachments.map(({ filename, contentType, disposition }) => ({ filename, contentType, disposition })),
			[
				{ filename: 'notes.txt', contentType: 'text/plain', disposition: 'attachment' },
				{ filename: 'empty.bin', contentType: 'application/octet-stream', disposition: 'attachment' }
			]
		);
		assert.equal(new TextDecoder().decode(attachments[0].content as Uint8Array), 'Notes');
		assert.equal(attachments[1].content, null);
	});
});
