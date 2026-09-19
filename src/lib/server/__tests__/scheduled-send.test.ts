import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { EmailRow } from '$lib/types';
import type { EmailProvider, ProviderDomain } from '../email-provider';
import type { OutboundMailInput } from '../outbound/send-mail';
import { cancelScheduledSend, runDueScheduledSends } from '../scheduled-send';

const PAST = '2026-09-01T09:00:00.000Z';
const FUTURE = '2099-01-01T09:00:00.000Z';

function scheduledRow(overrides: Partial<EmailRow> = {}): EmailRow {
	return {
		id: 'mail-1',
		user_id: 'user-1',
		direction: 'outbound',
		from_addr: 'ada@ourdomain.test',
		from_name: 'Ada',
		to_addr: 'grace@example.com',
		cc_addr: null,
		bcc_addr: null,
		subject: 'Quarterly figures',
		body_text: 'The numbers are attached.',
		body_html: '<p>The numbers are attached.</p>',
		message_id: null,
		in_reply_to: null,
		references_header: null,
		reply_to_email_id: null,
		thread_id: 'thread-1',
		thread_key: 'quarterly figures',
		domain_id: 'dom-1',
		address_id: 'addr-1',
		provider_id: null,
		status: 'scheduled',
		status_at: PAST,
		scheduled_at: PAST,
		send_attempts: 0,
		status_detail: null,
		is_read: 1,
		is_starred: 0,
		deleted_at: null,
		archived_at: null,
		spam_at: null,
		category: null,
		created_at: PAST,
		...overrides
	};
}

/**
 * An in-memory stand-in for the handful of statements the sweep runs.
 *
 * The point of the mock is the claim: `UPDATE … WHERE status = 'scheduled'`
 * has to report zero changes the second time, because that is the only thing
 * standing between two overlapping sweeps and a message sent twice.
 */
function mockDb(rows: EmailRow[]) {
	const store = new Map(rows.map((row) => [row.id, { ...row }]));

	const db = {
		prepare(sql: string) {
			return {
				bind(...args: unknown[]) {
					return {
						async all() {
							if (sql.includes("status = 'scheduled'") && sql.includes('SELECT id FROM emails')) {
								const [now, maxAttempts, userId] = args as [string, number, string?];
								const due = [...store.values()]
									.filter(
										(row) =>
											row.status === 'scheduled' &&
											row.scheduled_at !== null &&
											row.scheduled_at <= now &&
											row.provider_id === null &&
											row.deleted_at === null &&
											row.send_attempts < maxAttempts &&
											(userId === undefined || row.user_id === userId)
									)
									.sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1));
								return { results: due.map((row) => ({ id: row.id })) };
							}
							// readOutboundAttachments — nothing attached in these cases.
							return { results: [] };
						},
						async first() {
							if (sql.includes('FROM users')) {
								return {
									id: 'user-1',
									email: 'ada@ourdomain.test',
									name: 'Ada',
									is_admin: 0,
									created_at: PAST
								};
							}
							if (sql.includes('FROM addresses')) {
								return null;
							}
							if (sql.includes('SELECT * FROM emails')) {
								return store.get(String(args[0])) ?? null;
							}
							return null;
						},
						async run() {
							// The claim, and the cancel, are both guarded on the row still
							// being scheduled.
							if (sql.includes("status = 'queued'") && sql.includes("status = 'scheduled'")) {
								const row = store.get(String(args[0]));
								if (!row || row.status !== 'scheduled') return { meta: { changes: 0 } };
								row.status = 'queued';
								row.send_attempts += 1;
								return { meta: { changes: 1 } };
							}
							if (sql.includes("status = 'draft'")) {
								const [id, userId] = args as [string, string];
								const row = store.get(id);
								if (!row || row.user_id !== userId || row.status !== 'scheduled') {
									return { meta: { changes: 0 } };
								}
								row.status = 'draft';
								row.scheduled_at = null;
								row.send_attempts = 0;
								return { meta: { changes: 1 } };
							}
							if (sql.includes('provider_id = ?')) {
								const [status, providerId, id] = args as [EmailRow['status'], string, string];
								const row = store.get(id);
								if (row) {
									row.status = status;
									row.provider_id = providerId;
									row.status_detail = null;
								}
								return { meta: { changes: row ? 1 : 0 } };
							}
							if (sql.includes('status_detail = ?')) {
								const [status, detail, id] = args as [EmailRow['status'], string, string];
								const row = store.get(id);
								if (row) {
									row.status = status;
									row.status_detail = detail;
								}
								return { meta: { changes: row ? 1 : 0 } };
							}
							return { meta: { changes: 0 } };
						}
					};
				}
			};
		}
	} as unknown as D1Database;

	return { db, store };
}

const bucket = {} as R2Bucket;

function recordingProvider(behaviour: 'ok' | 'reject' = 'ok') {
	const calls: OutboundMailInput[] = [];

	const provider: EmailProvider = {
		kind: 'resend',
		async send(input) {
			calls.push(input);
			if (behaviour === 'reject') throw new Error('Domain is not verified');
			return { providerId: `msg_${calls.length}` };
		},
		async listDomains(): Promise<ProviderDomain[]> {
			return [];
		},
		async getDomain(): Promise<ProviderDomain> {
			throw new Error('not used');
		}
	};

	return { provider, calls };
}

describe('sending scheduled mail from the outbox', () => {
	test('a message whose time has come goes out', async () => {
		const { db, store } = mockDb([scheduledRow()]);
		const { provider, calls } = recordingProvider();

		const result = await runDueScheduledSends({ DB: db, ATTACHMENTS: bucket }, provider);

		assert.deepEqual(result, { sent: 1, failed: 0 });
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0].to, ['grace@example.com']);
		assert.equal(store.get('mail-1')?.status, 'queued');
		assert.equal(store.get('mail-1')?.provider_id, 'msg_1');
	});

	test('a message still in the future is left alone', async () => {
		const { db } = mockDb([scheduledRow({ scheduled_at: FUTURE })]);
		const { provider, calls } = recordingProvider();

		const result = await runDueScheduledSends({ DB: db, ATTACHMENTS: bucket }, provider);

		assert.deepEqual(result, { sent: 0, failed: 0 });
		assert.equal(calls.length, 0);
	});

	test('a second sweep does not send the same message again', async () => {
		const { db } = mockDb([scheduledRow()]);
		const { provider, calls } = recordingProvider();
		const env = { DB: db, ATTACHMENTS: bucket };

		await runDueScheduledSends(env, provider);
		await runDueScheduledSends(env, provider);

		assert.equal(calls.length, 1);
	});

	test('a rejected message waits for the next sweep', async () => {
		const { db, store } = mockDb([scheduledRow()]);
		const { provider } = recordingProvider('reject');

		const result = await runDueScheduledSends({ DB: db, ATTACHMENTS: bucket }, provider);

		assert.deepEqual(result, { sent: 0, failed: 1 });
		assert.equal(store.get('mail-1')?.status, 'scheduled');
		assert.equal(store.get('mail-1')?.status_detail, 'Domain is not verified');
	});

	test('a message out of tries is marked failed rather than retried forever', async () => {
		const { db, store } = mockDb([scheduledRow({ send_attempts: 2 })]);
		const { provider } = recordingProvider('reject');
		const env = { DB: db, ATTACHMENTS: bucket };

		await runDueScheduledSends(env, provider);
		assert.equal(store.get('mail-1')?.status, 'failed');

		// And a later sweep leaves it alone rather than picking it back up.
		const after = await runDueScheduledSends(env, provider);
		assert.deepEqual(after, { sent: 0, failed: 0 });
	});

	test('one bad message does not strand the rest of the batch', async () => {
		const { db, store } = mockDb([
			scheduledRow({ id: 'mail-1', to_addr: 'grace@example.com' }),
			scheduledRow({ id: 'mail-2', to_addr: 'alan@example.com' })
		]);
		let first = true;
		const provider: EmailProvider = {
			kind: 'resend',
			async send() {
				if (first) {
					first = false;
					throw new Error('Domain is not verified');
				}
				return { providerId: 'msg_2' };
			},
			async listDomains(): Promise<ProviderDomain[]> {
				return [];
			},
			async getDomain(): Promise<ProviderDomain> {
				throw new Error('not used');
			}
		};

		const result = await runDueScheduledSends({ DB: db, ATTACHMENTS: bucket }, provider);

		assert.deepEqual(result, { sent: 1, failed: 1 });
		assert.equal(store.get('mail-2')?.provider_id, 'msg_2');
	});
});

describe('recalling a scheduled message', () => {
	test('a waiting message becomes a draft again', async () => {
		const { db, store } = mockDb([scheduledRow()]);

		assert.equal(await cancelScheduledSend(db, 'user-1', 'mail-1'), true);
		assert.equal(store.get('mail-1')?.status, 'draft');
		assert.equal(store.get('mail-1')?.scheduled_at, null);
	});

	test('a message the sweep already took stays sent mail', async () => {
		const { db, store } = mockDb([scheduledRow()]);
		const { provider } = recordingProvider();

		await runDueScheduledSends({ DB: db, ATTACHMENTS: bucket }, provider);

		assert.equal(await cancelScheduledSend(db, 'user-1', 'mail-1'), false);
		assert.equal(store.get('mail-1')?.status, 'queued');
	});

	test('another account cannot recall it', async () => {
		const { db, store } = mockDb([scheduledRow()]);

		assert.equal(await cancelScheduledSend(db, 'user-2', 'mail-1'), false);
		assert.equal(store.get('mail-1')?.status, 'scheduled');
	});
});
