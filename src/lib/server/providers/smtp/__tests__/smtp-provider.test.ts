import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ProviderError } from '../../../email-provider';
import { ConfigError } from '../../../errors';
import type { MailAddress } from '$lib/types';
import { createSmtpProvider, smtpConfigured } from '../../smtp-provider';
import type { SmtpConnect } from '../client';

type Session = { security?: string; port?: number; commands: string[]; data: string };

/** A relay that accepts everything except RCPT for `reject@...`, recording each session. */
function fakeRelay(options: { failWith?: string } = {}) {
	const sessions: Session[] = [];
	const connect: SmtpConnect = async ({ security, port }) => {
		const session: Session = { security, port, commands: [], data: '' };
		sessions.push(session);
		const outbox = ['220 ready\r\n'];
		let inData = false;
		let pending = '';
		const socket = {
			async write(bytes: Uint8Array) {
				pending += new TextDecoder().decode(bytes);
				let end: number;
				while ((end = pending.indexOf('\r\n')) >= 0) {
					const line = pending.slice(0, end);
					pending = pending.slice(end + 2);
					if (inData) {
						if (line === '.') {
							inData = false;
							outbox.push('250 queued\r\n');
						} else session.data += `${line}\r\n`;
						continue;
					}
					session.commands.push(line);
					if (line.startsWith('EHLO')) outbox.push('250-relay\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n');
					else if (line === 'STARTTLS') outbox.push('220 go\r\n');
					else if (line.startsWith('AUTH')) outbox.push('235 ok\r\n');
					else if (options.failWith && line.startsWith('MAIL')) outbox.push(options.failWith);
					else if (line === 'DATA') {
						inData = true;
						outbox.push('354 go\r\n');
					} else outbox.push('250 ok\r\n');
				}
			},
			read: async () => (outbox.length > 0 ? new TextEncoder().encode(outbox.shift()) : null),
			upgrade: async () => socket,
			close: async () => {}
		};
		return socket;
	};
	return { connect, sessions };
}

const FROM = { address: 'me@example.com' } as MailAddress;
const SETTINGS = { SMTP_HOST: 'smtp.relay.test', SMTP_USER: 'me', SMTP_PASSWORD: 'pw', SMTP_MAIL_DOMAINS: 'mine.test, Other.test' };

describe('createSmtpProvider', () => {
	test('sends Bcc in the envelope only, and returns its Message-ID as the provider id', async () => {
		const relay = fakeRelay();
		const provider = createSmtpProvider(SETTINGS, relay.connect);
		const { providerId } = await provider.send({
			from: FROM,
			senderName: 'Me',
			to: ['ada@x.test'],
			cc: ['cee@x.test'],
			bcc: ['hidden@x.test'],
			subject: 'Hi',
			text: 'Hello',
			headers: { 'In-Reply-To': '<parent@x.test>' }
		});

		const [session] = relay.sessions;
		assert.deepEqual(
			session.commands.filter((line) => line.startsWith('RCPT')),
			['RCPT TO:<ada@x.test>', 'RCPT TO:<cee@x.test>', 'RCPT TO:<hidden@x.test>']
		);
		assert.doesNotMatch(session.data, /hidden@x\.test/);
		assert.match(providerId, /^[0-9a-f-]{36}@example\.com$/);
		assert.match(session.data, new RegExp(`^Message-ID: <${providerId}>\r$`, 'm'));
		assert.match(session.data, /^In-Reply-To: <parent@x\.test>\r$/m);
		assert.equal(provider.kind, 'smtp');
	});

	test('port 465 means TLS from the start; anything else defaults to STARTTLS on 587', async () => {
		const relay = fakeRelay();
		const message = { from: FROM, senderName: 'Me', to: 'a@x.test', subject: 's', text: 't' };
		await createSmtpProvider({ ...SETTINGS, SMTP_PORT: '465' }, relay.connect).send(message);
		await createSmtpProvider(SETTINGS, relay.connect).send(message);
		assert.deepEqual(
			relay.sessions.map(({ security, port }) => [security, port]),
			[
				['tls', 465],
				['starttls', 587]
			]
		);
		assert.ok(relay.sessions[1].commands.includes('STARTTLS'));
	});

	test('a 5xx is a rejection, a 4xx is worth retrying', async () => {
		const message = { from: FROM, senderName: 'Me', to: 'a@x.test', subject: 's', text: 't' };
		const rejected = await createSmtpProvider(SETTINGS, fakeRelay({ failWith: '550 5.7.1 Sender not allowed\r\n' }).connect)
			.send(message)
			.catch((error: unknown) => error);
		assert.ok(rejected instanceof ProviderError);
		assert.equal(rejected.code, 'smtp_rejected');
		assert.equal(rejected.status, 400);
		assert.match(rejected.message, /Sender not allowed/);

		const busy = await createSmtpProvider(SETTINGS, fakeRelay({ failWith: '451 4.3.0 Try later\r\n' }).connect)
			.send(message)
			.catch((error: unknown) => error);
		assert.ok(busy instanceof ProviderError);
		assert.equal(busy.code, 'smtp_unavailable');
		assert.equal(busy.status, 502);
	});

	test('lists and finds the configured domains', async () => {
		const provider = createSmtpProvider(SETTINGS, fakeRelay().connect);
		assert.deepEqual((await provider.listDomains()).map((domain) => domain.name), ['mine.test', 'other.test']);
		assert.equal((await provider.getDomain('OTHER.test')).sendingEnabled, true);
		await assert.rejects(provider.getDomain('missing.test'), /not in SMTP_MAIL_DOMAINS/);
	});

	test('bad settings are configuration errors', () => {
		assert.throws(() => createSmtpProvider({}), ConfigError);
		assert.throws(() => createSmtpProvider({ SMTP_HOST: 'h', SMTP_PORT: '99999' }), /not a port/);
		assert.throws(() => createSmtpProvider({ SMTP_HOST: 'h', SMTP_SECURITY: 'ssl' }), /tls, starttls or none/);
	});

	test('is configured once there is a host and at least one domain', () => {
		assert.equal(smtpConfigured(SETTINGS), true);
		assert.equal(smtpConfigured({ SMTP_HOST: 'h' }), false);
		assert.equal(smtpConfigured({ SMTP_MAIL_DOMAINS: 'mine.test' }), false);
	});
});
