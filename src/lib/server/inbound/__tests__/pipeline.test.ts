import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_EMAIL } from '../../constants';
import { createSqliteD1 } from '../../__tests__/support/sqlite-d1';
import type { ResendClient } from '../../providers/resend-client';
import { storeInbound, storeInboundAttachments, type InboundAttachment, type InboundEnv } from '../pipeline';
import { fromRawMime } from '../raw-mime';
import { fromResendEvent } from '../resend-webhook';

function memoryBucket(options: { failPut?: boolean } = {}) {
	const keys: string[] = [];
	const bucket = {
		async put(key: string) {
			if (options.failPut) throw new Error('R2 unavailable');
			keys.push(key);
		}
	} as unknown as R2Bucket;
	return { bucket, keys };
}

function stubDb(): D1Database {
	return {
		prepare() {
			return {
				bind() {
					return { async run() {} };
				}
			};
		}
	} as unknown as D1Database;
}

function part(index: number, byteLength = 10, extra: Partial<InboundAttachment> = {}): InboundAttachment {
	return {
		filename: `file-${index}.txt`,
		contentType: 'text/plain',
		content: new Uint8Array(byteLength),
		...extra
	};
}

function parts(count: number, byteLength = 10): InboundAttachment[] {
	return Array.from({ length: count }, (_, index) => part(index, byteLength));
}

describe('storeInboundAttachments', () => {
	test('returns what was stored', async () => {
		const { bucket, keys } = memoryBucket();
		const stored = await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: bucket }, 'email-1', parts(3));
		assert.equal(stored.length, 3);
		assert.equal(keys.length, 3);
	});

	test('fetches bytes the source only promised', async () => {
		const { bucket } = memoryBucket();
		let fetched = 0;
		const lazy = part(0, 0, {
			content: async () => {
				fetched++;
				return new Uint8Array(4);
			}
		});
		const stored = await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: bucket }, 'email-1', [lazy]);
		assert.equal(fetched, 1);
		assert.deepEqual(stored.map((item) => item.sizeBytes), [4]);
	});

	test('does not include a part the source listed but never delivered', async () => {
		// Announcing it would promise the reader a file the mailbox does not have.
		const { bucket } = memoryBucket();
		const stored = await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: bucket }, 'email-1', [
			part(0),
			part(1, 0, { content: null })
		]);
		assert.equal(stored.length, 1);
	});

	test('skips a part the listing already says is oversized, without fetching it', async () => {
		const { bucket } = memoryBucket();
		let fetched = 0;
		const big = part(0, 0, {
			size: MAX_ATTACHMENT_BYTES + 1,
			content: async () => {
				fetched++;
				return new Uint8Array(10);
			}
		});
		assert.equal((await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: bucket }, 'email-1', [big])).length, 0);
		assert.equal(fetched, 0);
	});

	test('does not include a part whose body turns out to be oversized', async () => {
		// `size` from a listing is advisory; the bytes are the truth.
		const { bucket } = memoryBucket();
		const stored = await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: bucket }, 'email-1', [
			part(0, MAX_ATTACHMENT_BYTES + 1, { size: 10 })
		]);
		assert.equal(stored.length, 0);
	});

	test('does not include a part whose storage or fetch fails', async () => {
		const failing = memoryBucket({ failPut: true });
		assert.equal((await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: failing.bucket }, 'email-1', parts(2))).length, 0);

		const { bucket } = memoryBucket();
		const broken = part(0, 0, {
			content: async () => {
				throw new Error('download failed');
			}
		});
		assert.equal((await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: bucket }, 'email-1', [broken, part(1)])).length, 1);
	});

	test('stores no more than the per-message cap', async () => {
		const { bucket } = memoryBucket();
		const stored = await storeInboundAttachments(
			{ DB: stubDb(), ATTACHMENTS: bucket },
			'email-1',
			parts(MAX_ATTACHMENTS_PER_EMAIL + 3)
		);
		assert.equal(stored.length, MAX_ATTACHMENTS_PER_EMAIL);
	});

	test('fills in a name and type for a part that has none', async () => {
		const { bucket } = memoryBucket();
		const stored = await storeInboundAttachments({ DB: stubDb(), ATTACHMENTS: bucket }, 'email-1', [
			{ filename: '', contentType: '', content: new Uint8Array(3) }
		]);
		assert.deepEqual(stored.map(({ filename, contentType }) => ({ filename, contentType })), [
			{ filename: 'attachment', contentType: 'application/octet-stream' }
		]);
	});
});

// The same message, as Resend's webhook hands it over and as raw MIME.
const MESSAGE = {
	from: 'Ada Lovelace <ada@example.net>',
	to: 'me@mine.test',
	cc: 'Bob <bob@example.org>',
	subject: 'Engine notes',
	text: 'See the attached notes.',
	html: '<p>See the attached notes.</p>',
	messageId: 'notes-1@example.net',
	inReplyTo: 'start@example.net',
	references: '<start@example.net>',
	attachment: { filename: 'notes.txt', type: 'text/plain', body: 'Analytical engine' }
};

const RAW_MIME = [
	`From: ${MESSAGE.from}`,
	`To: ${MESSAGE.to}`,
	`Cc: ${MESSAGE.cc}`,
	`Subject: ${MESSAGE.subject}`,
	`Message-ID: <${MESSAGE.messageId}>`,
	`In-Reply-To: <${MESSAGE.inReplyTo}>`,
	`References: ${MESSAGE.references}`,
	'Date: Tue, 10 Nov 2026 10:00:00 +0000',
	'MIME-Version: 1.0',
	'Content-Type: multipart/mixed; boundary="b1"',
	'',
	'--b1',
	'Content-Type: multipart/alternative; boundary="b2"',
	'',
	'--b2',
	'Content-Type: text/plain; charset=utf-8',
	'',
	MESSAGE.text,
	'--b2',
	'Content-Type: text/html; charset=utf-8',
	'',
	MESSAGE.html,
	'--b2--',
	'--b1',
	`Content-Type: ${MESSAGE.attachment.type}; name="${MESSAGE.attachment.filename}"`,
	`Content-Disposition: attachment; filename="${MESSAGE.attachment.filename}"`,
	'',
	MESSAGE.attachment.body,
	'--b1--',
	''
].join('\r\n');

function resendClient(): ResendClient {
	return {
		async getReceivedEmail() {
			return {
				object: 'email',
				id: 'resend-1',
				from: MESSAGE.from,
				to: [MESSAGE.to],
				cc: ['bob@example.org'],
				subject: MESSAGE.subject,
				text: MESSAGE.text,
				html: MESSAGE.html,
				headers: {
					'Message-ID': `<${MESSAGE.messageId}>`,
					'In-Reply-To': MESSAGE.inReplyTo,
					References: MESSAGE.references
				},
				created_at: '2026-11-10T10:00:00Z',
				message_id: MESSAGE.messageId,
				received_for: [MESSAGE.to]
			};
		},
		async listReceivedAttachments() {
			return [
				{
					id: 'att-1',
					filename: MESSAGE.attachment.filename,
					content_type: MESSAGE.attachment.type,
					content_disposition: 'attachment',
					download_url: 'https://resend.test/att-1'
				}
			];
		},
		async downloadAttachment() {
			return new TextEncoder().encode(MESSAGE.attachment.body);
		}
	} as unknown as ResendClient;
}

function rawSource() {
	const raw = new TextEncoder().encode(RAW_MIME);
	const headers = new Headers();
	for (const line of RAW_MIME.split('\r\n\r\n')[0].split('\r\n')) {
		const colon = line.indexOf(':');
		headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
	}
	return fromRawMime(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), {
		from: 'bounces@example.net',
		to: MESSAGE.to,
		headers
	});
}

function resendSource() {
	const source = fromResendEvent(resendClient(), {
		type: 'email.received',
		data: { email_id: 'resend-1', received_for: [MESSAGE.to] }
	});
	assert.ok(source);
	return source;
}

function mailbox() {
	const { db, sqlite } = createSqliteD1();
	sqlite.exec(`
		INSERT INTO users (id, email, name, password_hash) VALUES ('user-1', 'me@mine.test', 'Me', 'hash');
		INSERT INTO domains (id, name, status, receiving_enabled) VALUES ('domain-1', 'mine.test', 'verified', 1);
		INSERT INTO addresses (id, user_id, domain_id, address) VALUES ('address-1', 'user-1', 'domain-1', 'me@mine.test');
	`);
	const { bucket, keys } = memoryBucket();
	const env: InboundEnv = { DB: db, ATTACHMENTS: bucket };
	return { env, sqlite, keys };
}

type StoredRow = Record<string, unknown>;

function storedEmail(sqlite: ReturnType<typeof mailbox>['sqlite']): StoredRow {
	const row = sqlite
		.prepare(
			`SELECT user_id, direction, from_addr, from_name, to_addr, cc_addr, subject, body_text, body_html,
			        message_id, in_reply_to, references_header, domain_id, address_id, spam_at, category
			 FROM emails`
		)
		.get() as StoredRow;
	return { ...row };
}

function storedAttachments(sqlite: ReturnType<typeof mailbox>['sqlite']): StoredRow[] {
	return (
		sqlite
			.prepare('SELECT filename, content_type, size_bytes, content_disposition, content_id FROM email_attachments')
			.all() as StoredRow[]
	).map((row) => ({ ...row }));
}

describe('storeInbound', () => {
	test('stores the same message identically from the Resend webhook and raw MIME', async () => {
		const viaResend = mailbox();
		const viaRaw = mailbox();

		const resendOutcome = await storeInbound(viaResend.env, resendSource());
		const rawOutcome = await storeInbound(viaRaw.env, await rawSource());

		assert.equal(resendOutcome.kind, 'stored');
		assert.equal(rawOutcome.kind, 'stored');
		assert.deepEqual(storedEmail(viaRaw.sqlite), storedEmail(viaResend.sqlite));
		assert.deepEqual(storedAttachments(viaRaw.sqlite), storedAttachments(viaResend.sqlite));
		assert.equal(viaRaw.keys.length, 1);
		assert.equal(viaResend.keys.length, 1);

		const row = storedEmail(viaRaw.sqlite);
		assert.equal(row.from_addr, 'ada@example.net');
		assert.equal(row.from_name, 'Ada Lovelace');
		assert.equal(row.to_addr, 'me@mine.test');
		assert.equal(row.cc_addr, 'bob@example.org');
		assert.equal(row.message_id, MESSAGE.messageId);
		assert.equal(row.in_reply_to, MESSAGE.inReplyTo);
		assert.equal(row.spam_at, null);
	});

	test('keeps each source’s provider id, so mail already stored is still recognised', async () => {
		assert.equal(resendSource().providerId, 'resend-1');
		assert.equal((await rawSource()).providerId, MESSAGE.messageId);
	});

	test('a repeated delivery is recognised before the message is read', async () => {
		const { env, sqlite } = mailbox();
		assert.equal((await storeInbound(env, await rawSource())).kind, 'stored');

		const again = await storeInbound(env, {
			providerId: MESSAGE.messageId,
			read: async () => assert.fail('a duplicate must not be read')
		});
		assert.deepEqual(again, { kind: 'duplicate' });
		assert.equal(sqlite.prepare('SELECT count(*) AS n FROM emails').get()?.n, 1);
	});

	test('mail nobody here receives is recorded as unrouted, once', async () => {
		const { env, sqlite } = mailbox();
		const source = await fromRawMime(new TextEncoder().encode(RAW_MIME).buffer as ArrayBuffer, {
			from: 'bounces@example.net',
			to: 'stranger@elsewhere.test',
			headers: new Headers()
		});
		// The message itself is addressed to me@mine.test; the envelope decides who
		// it was delivered to, and both are tried.
		sqlite.exec("DELETE FROM addresses");

		assert.deepEqual(await storeInbound(env, source), { kind: 'unrouted', recorded: true });
		assert.deepEqual(await storeInbound(env, source), { kind: 'unrouted', recorded: false });

		const unrouted = sqlite.prepare('SELECT from_addr, to_addr, subject FROM unrouted_emails').all();
		assert.equal(unrouted.length, 1);
		assert.equal(unrouted[0].from_addr, 'ada@example.net');
		assert.equal(unrouted[0].subject, MESSAGE.subject);
		assert.equal(sqlite.prepare('SELECT count(*) AS n FROM emails').get()?.n, 0);
	});

	test('mail that fails authentication is kept as spam and not announced', async () => {
		const { env, sqlite } = mailbox();
		const headers = new Headers({ 'Authentication-Results': 'mx.mine.test; dmarc=fail' });
		const source = await fromRawMime(new TextEncoder().encode(RAW_MIME).buffer as ArrayBuffer, {
			from: 'bounces@example.net',
			to: MESSAGE.to,
			headers
		});

		assert.deepEqual(await storeInbound(env, source), { kind: 'spam', address: 'me@mine.test' });
		assert.notEqual(storedEmail(sqlite).spam_at, null);
	});
});
