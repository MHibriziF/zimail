import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_BODY_BYTES } from '../../constants';
import type { ReceivedAttachment, ReceivedEmail, ResendClient } from '../../providers/resend-client';
import { fromResendEvent } from '../resend-webhook';

function received(overrides: Partial<ReceivedEmail> = {}): ReceivedEmail {
	return {
		object: 'email',
		id: 'msg-1',
		from: 'Ada <ada@example.net>',
		to: ['me@mine.test'],
		subject: 'Hello',
		html: '<p>Hi</p>',
		text: 'Hi',
		created_at: '2026-11-10T10:00:00Z',
		...overrides
	};
}

function client(options: {
	byFormat?: Partial<Record<'data_uri' | 'cid', Partial<ReceivedEmail>>>;
	attachments?: ReceivedAttachment[] | Error;
} = {}) {
	const formats: string[] = [];
	const resend = {
		async getReceivedEmail(_id: string, format: 'data_uri' | 'cid') {
			formats.push(format);
			return received(options.byFormat?.[format]);
		},
		async listReceivedAttachments() {
			if (options.attachments instanceof Error) throw options.attachments;
			return options.attachments ?? [];
		},
		async downloadAttachment(url: string) {
			return new TextEncoder().encode(url);
		}
	} as unknown as ResendClient;
	return { resend, formats };
}

function source(resend: ResendClient, data: Record<string, unknown> = { email_id: 'msg-1' }) {
	const result = fromResendEvent(resend, { type: 'email.received', data });
	assert.ok(result);
	return result;
}

describe('fromResendEvent', () => {
	test('names the id without touching the API, so a duplicate costs no request', () => {
		const { resend, formats } = client();
		assert.equal(source(resend).providerId, 'msg-1');
		assert.deepEqual(formats, []);
	});

	test('an event without an email id is not a source', () => {
		assert.equal(fromResendEvent(client().resend, { type: 'email.received', data: {} }), null);
		assert.equal(fromResendEvent(client().resend, { type: 'email.received', data: { email_id: '  ' } }), null);
	});

	test('reads the sender, recipients and body from the API', async () => {
		const { resend } = client({
			byFormat: { data_uri: { cc: ['bob@example.org'], bcc: ['carol@example.org'] } }
		});
		const message = await source(resend, { email_id: 'msg-1', received_for: ['alias@mine.test'] }).read();

		assert.equal(message.from, 'ada@example.net');
		assert.equal(message.fromName, 'Ada');
		assert.deepEqual(message.recipients, ['alias@mine.test', 'me@mine.test', 'bob@example.org', 'carol@example.org']);
		assert.deepEqual(message.cc, ['bob@example.org']);
		assert.equal(message.envelopeTo, null);
		assert.equal(message.subject, 'Hello');
		assert.equal(message.text, 'Hi');
		assert.equal(message.html, '<p>Hi</p>');
	});

	test('falls back to cid HTML when inline images inflate the data-URI body', async () => {
		const { resend, formats } = client({
			byFormat: { data_uri: { html: 'x'.repeat(MAX_BODY_BYTES + 1) }, cid: { html: '<img src="cid:1">' } }
		});
		const message = await source(resend).read();
		assert.deepEqual(formats, ['data_uri', 'cid']);
		assert.equal(message.html, '<img src="cid:1">');
	});

	test('reads headers whatever their casing', async () => {
		const { resend } = client({
			byFormat: {
				data_uri: {
					headers: {
						'In-Reply-To': '<parent@example.net>',
						References: '<root@example.net> <parent@example.net>',
						'Authentication-Results': 'mx; dmarc=pass'
					}
				}
			}
		});
		const message = await source(resend).read();
		assert.equal(message.inReplyTo, '<parent@example.net>');
		assert.equal(message.references, '<root@example.net> <parent@example.net>');
		assert.equal(message.header('authentication-results'), 'mx; dmarc=pass');
		assert.equal(message.header('list-unsubscribe'), undefined);
	});

	test('lists attachments only when asked, with a fetch for each one that has a download url', async () => {
		const { resend } = client({
			attachments: [
				{ id: 'a1', filename: 'notes.txt', content_type: 'text/plain', size: 17, download_url: 'https://resend.test/a1' },
				{ id: 'a2', filename: 'ghost.txt', content_type: 'text/plain' }
			]
		});
		const attachments = await (await source(resend).read()).attachments();

		assert.equal(attachments.length, 2);
		assert.equal(attachments[0].filename, 'notes.txt');
		assert.equal(attachments[0].size, 17);
		assert.equal(typeof attachments[0].content, 'function');
		assert.equal(new TextDecoder().decode(await (attachments[0].content as () => Promise<Uint8Array>)()), 'https://resend.test/a1');
		assert.equal(attachments[1].content, null);
	});

	test('a failed listing means no attachments, not a failed message', async () => {
		const { resend } = client({ attachments: new Error('Resend down') });
		assert.deepEqual(await (await source(resend).read()).attachments(), []);
	});
});
