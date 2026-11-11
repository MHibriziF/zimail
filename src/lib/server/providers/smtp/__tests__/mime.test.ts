import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import PostalMime from 'postal-mime';
import { buildMime, encodeWords, formatAddress, type MimeInput } from '../mime';

let counter = 0;
const boundary = () => `b${++counter}`;

function input(overrides: Partial<MimeInput> = {}): MimeInput {
	return {
		from: { address: 'zoe@example.com', name: 'Zoë Ünicode' },
		to: ['ada@example.org'],
		cc: ['cee@example.org'],
		subject: 'Résumé — ' + 'a long subject '.repeat(8),
		text: 'Hello\n.\nA line with a dot, and ünïcode',
		html: `<p>Hello <img src="cid:logo"></p>${'x'.repeat(2_000)}`,
		headers: { 'In-Reply-To': '<abc@example.com>', References: '<abc@example.com>' },
		attachments: [
			{ filename: 'logo.png', type: 'image/png', content: btoa('PNGDATA'), disposition: 'inline', contentId: 'logo' },
			{ filename: 'résumé.pdf', type: 'application/pdf', content: btoa('PDFDATA'), disposition: 'attachment' }
		],
		messageId: 'id-1@example.com',
		date: new Date('2026-11-11T09:30:00Z'),
		boundary,
		...overrides
	};
}

describe('buildMime', () => {
	const raw = buildMime(input());

	test('only CRLF line endings, and no line over 78 characters', () => {
		assert.equal(raw.replaceAll('\r\n', '').includes('\n'), false);
		assert.equal(raw.replaceAll('\r\n', '').includes('\r'), false);
		for (const line of raw.split('\r\n')) assert.ok(line.length <= 78, `too long: ${line}`);
	});

	test('writes the envelope headers, and never a Bcc', () => {
		assert.match(raw, /^From: =\?UTF-8\?B\?.+\?= <zoe@example\.com>\r\n/m);
		assert.match(raw, /^To: <ada@example\.org>\r\n/m);
		assert.match(raw, /^Cc: <cee@example\.org>\r\n/m);
		assert.match(raw, /^Date: Wed, 11 Nov 2026 09:30:00 \+0000\r\n/m);
		assert.match(raw, /^Message-ID: <id-1@example\.com>\r\n/m);
		assert.match(raw, /^In-Reply-To: <abc@example\.com>\r\n/m);
		assert.doesNotMatch(raw, /^Bcc:/im);
	});

	test('a parser reads back the same message', async () => {
		const parsed = await PostalMime.parse(raw);
		assert.equal(parsed.from?.address, 'zoe@example.com');
		assert.equal(parsed.from?.name, 'Zoë Ünicode');
		assert.equal(parsed.subject, input().subject.trim());
		assert.equal(parsed.messageId, '<id-1@example.com>');
		assert.equal(parsed.inReplyTo, '<abc@example.com>');
		assert.equal(parsed.text?.trim(), 'Hello\n.\nA line with a dot, and ünïcode');
		assert.equal(parsed.html, input().html);

		const [logo, pdf] = parsed.attachments;
		assert.equal(logo.filename, 'logo.png');
		assert.equal(logo.contentId, '<logo>');
		assert.equal(logo.disposition, 'inline');
		assert.equal(new TextDecoder().decode(logo.content as ArrayBuffer), 'PNGDATA');
		assert.equal(pdf.filename, 'résumé.pdf');
		assert.equal(pdf.disposition, 'attachment');
		assert.equal(new TextDecoder().decode(pdf.content as ArrayBuffer), 'PDFDATA');
	});

	test('nests alternative inside related inside mixed', () => {
		const types = [...raw.matchAll(/Content-Type: (multipart\/\w+)/g)].map((match) => match[1]);
		assert.deepEqual(types, ['multipart/mixed', 'multipart/related', 'multipart/alternative']);
	});

	test('real random boundaries keep lines short too', () => {
		const random = buildMime(input({ boundary: undefined }));
		for (const line of random.split('\r\n')) assert.ok(line.length <= 78, `too long: ${line}`);
	});

	test('a text-only message is a single part', async () => {
		const plain = buildMime(input({ html: undefined, attachments: [] }));
		assert.doesNotMatch(plain, /multipart/);
		assert.equal((await PostalMime.parse(plain)).text?.trim(), 'Hello\n.\nA line with a dot, and ünïcode');
	});

	test('line breaks in header values cannot add headers', () => {
		const injected = buildMime(
			input({
				subject: 'Hi\r\nBcc: victim@example.net',
				from: { address: 'zoe@example.com', name: 'Zoe\nX-Evil: 1' },
				headers: { 'X-Note\r\nBcc': 'a\r\nBcc: b@example.net' }
			})
		);
		assert.doesNotMatch(injected, /^Bcc:/im);
		assert.doesNotMatch(injected, /^X-Evil:/im);
	});

	test("a caller's headers can't replace the ones the builder writes", () => {
		const overridden = buildMime(input({ headers: { From: 'mallory@example.net', 'Message-ID': '<forged@x>' } }));
		assert.equal(overridden.match(/^From:/gim)?.length, 1);
		assert.doesNotMatch(overridden, /mallory|forged/);
	});
});

describe('attachment names', () => {
	test('a long non-ASCII name survives, split into RFC 2231 continuations', async () => {
		const filename = `Ünïcödé quarterly report — ${'données '.repeat(12)}.pdf`;
		const raw = buildMime(input({ attachments: [{ filename, type: 'application/pdf', content: btoa('x'), disposition: 'attachment' }] }));
		assert.match(raw, /filename\*1\*=/);
		for (const line of raw.split('\r\n')) assert.ok(line.length <= 78, `too long: ${line}`);
		assert.equal((await PostalMime.parse(raw)).attachments[0].filename, filename);
	});
});

describe('encodeWords', () => {
	test('keeps every encoded word within 75 characters, without splitting a character', async () => {
		const long = '日本語のメールの件名がとても長い場合でも正しく分割されること'.repeat(3);
		const encoded = encodeWords(long);
		for (const word of encoded.split('\r\n ')) assert.ok(word.length <= 75, word);
		const parsed = await PostalMime.parse(`Subject: ${encoded}\r\n\r\nbody`);
		assert.equal(parsed.subject, long);
	});
});

describe('formatAddress', () => {
	test('quotes ASCII names and escapes their quotes', () => {
		assert.equal(formatAddress('ada@example.org', 'Ada "the" Lovelace'), String.raw`"Ada \"the\" Lovelace" <ada@example.org>`);
		assert.equal(formatAddress('ada@example.org'), '<ada@example.org>');
	});
});
