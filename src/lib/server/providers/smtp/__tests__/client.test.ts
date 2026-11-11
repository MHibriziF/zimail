import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dotStuff, sendSmtp, SmtpError, type SmtpConfig, type SmtpConnect, type SmtpSocket } from '../client';

/**
 * A scripted SMTP server: each command the client sends is answered by
 * `respond`, and everything is recorded, including whether TLS was on.
 */
function fakeServer(respond: (line: string, state: { tls: boolean; inData: boolean }) => string | null) {
	const log: { line: string; tls: boolean }[] = [];
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();
	let connectedWith: unknown;
	let closed = false;

	const connect: SmtpConnect = async (options) => {
		connectedWith = options;
		const state = { tls: options.security === 'tls', inData: false };
		const outbox: string[] = ['220 fake.test ESMTP ready\r\n'];
		let pending = '';
		let data = '';

		function socket(): SmtpSocket {
			return {
				async write(bytes) {
					pending += decoder.decode(bytes);
					let end: number;
					while ((end = pending.indexOf('\r\n')) >= 0) {
						const line = pending.slice(0, end);
						pending = pending.slice(end + 2);
						if (state.inData) {
							if (line === '.') {
								state.inData = false;
								log.push({ line: `DATA>${data}`, tls: state.tls });
								outbox.push('250 2.0.0 Ok: queued as ABC123\r\n');
							} else {
								data += `${line}\r\n`;
							}
							continue;
						}
						log.push({ line, tls: state.tls });
						const reply = respond(line, state);
						if (line === 'DATA' && reply?.startsWith('354')) state.inData = true;
						if (reply) outbox.push(reply);
					}
				},
				async read() {
					return outbox.length > 0 ? encoder.encode(outbox.shift()) : null;
				},
				async upgrade() {
					state.tls = true;
					return socket();
				},
				async close() {
					closed = true;
				}
			};
		}
		return socket();
	};

	return { connect, log, connected: () => connectedWith, closed: () => closed };
}

/** A well-behaved relay offering STARTTLS and AUTH PLAIN LOGIN. */
function relay(line: string, state: { tls: boolean }): string | null {
	if (line.startsWith('EHLO')) {
		return state.tls ? '250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000000\r\n' : '250-fake.test\r\n250-STARTTLS\r\n250 SIZE 1000000\r\n';
	}
	if (line === 'STARTTLS') return '220 2.0.0 Ready to start TLS\r\n';
	if (line.startsWith('AUTH PLAIN')) return '235 2.7.0 Authentication successful\r\n';
	if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) return '250 2.1.0 Ok\r\n';
	if (line === 'DATA') return '354 End data with <CR><LF>.<CR><LF>\r\n';
	if (line === 'QUIT') return '221 2.0.0 Bye\r\n';
	return '500 5.5.2 Unknown command\r\n';
}

const CONFIG: SmtpConfig = { host: 'smtp.fake.test', port: 587, security: 'starttls', user: 'me', password: 'pw', clientName: 'example.com' };
const MESSAGE = 'Subject: hi\r\n\r\nHello\r\n.hidden line\r\n';

describe('sendSmtp', () => {
	test('STARTTLS before AUTH, then one RCPT per unique address, then the message', async () => {
		const server = fakeServer(relay);
		const accepted = await sendSmtp(server.connect, CONFIG, { from: 'me@example.com', to: ['a@x.test', 'B@x.test', 'b@x.test'] }, MESSAGE);

		assert.equal(accepted, '2.0.0 Ok: queued as ABC123');
		const lines = server.log.map((entry) => entry.line);
		assert.deepEqual(lines.slice(0, 3), ['EHLO example.com', 'STARTTLS', 'EHLO example.com']);
		const auth = server.log.find((entry) => entry.line.startsWith('AUTH PLAIN'));
		assert.equal(auth?.tls, true, 'the password only goes over TLS');
		assert.equal(atob(auth!.line.slice('AUTH PLAIN '.length)), '\u0000me\u0000pw');
		assert.deepEqual(
			lines.filter((line) => line.startsWith('MAIL') || line.startsWith('RCPT')),
			['MAIL FROM:<me@example.com>', 'RCPT TO:<a@x.test>', 'RCPT TO:<b@x.test>']
		);
		assert.equal(lines.find((line) => line.startsWith('DATA>')), 'DATA>Subject: hi\r\n\r\nHello\r\n..hidden line\r\n');
		assert.equal(server.closed(), true);
	});

	test('refuses to continue when STARTTLS is required but not offered', async () => {
		const server = fakeServer((line, state) => (line.startsWith('EHLO') ? '250 fake.test\r\n' : relay(line, state)));
		await assert.rejects(sendSmtp(server.connect, CONFIG, { from: 'me@example.com', to: ['a@x.test'] }, MESSAGE), /does not offer STARTTLS/);
		assert.equal(server.log.some((entry) => entry.line.startsWith('AUTH')), false);
	});

	test('never sends a password over an unencrypted connection', async () => {
		const server = fakeServer(relay);
		await assert.rejects(
			sendSmtp(server.connect, { ...CONFIG, security: 'none' }, { from: 'me@example.com', to: ['a@x.test'] }, MESSAGE),
			/unencrypted/
		);
		assert.equal(server.connected(), undefined, 'it does not even connect');
	});

	test('a local relay with no password needs no TLS or AUTH', async () => {
		const server = fakeServer((line, state) => (line.startsWith('EHLO') ? '250 localhost\r\n' : relay(line, state)));
		await sendSmtp(
			server.connect,
			{ host: 'localhost', port: 25, security: 'none', clientName: 'example.com' },
			{ from: 'me@example.com', to: ['a@x.test'] },
			MESSAGE
		);
		assert.equal(server.log.some((entry) => entry.line.startsWith('AUTH') || entry.line === 'STARTTLS'), false);
	});

	test('falls back to AUTH LOGIN', async () => {
		const server = fakeServer((line, state) => {
			if (line.startsWith('EHLO') && state.tls) return '250-fake.test\r\n250 AUTH LOGIN\r\n';
			if (line === 'AUTH LOGIN' || line === btoa('me')) return '334 VXNlcm5hbWU6\r\n';
			if (line === btoa('pw')) return '235 ok\r\n';
			return relay(line, state);
		});
		await sendSmtp(server.connect, CONFIG, { from: 'me@example.com', to: ['a@x.test'] }, MESSAGE);
		assert.ok(server.log.some((entry) => entry.line === btoa('pw') && entry.tls));
	});

	test('a rejected recipient stops the send with the server code', async () => {
		const server = fakeServer((line, state) =>
			line.startsWith('RCPT TO:<nobody') ? '550 5.1.1 No such user\r\n' : relay(line, state)
		);
		const error = await sendSmtp(server.connect, CONFIG, { from: 'me@example.com', to: ['nobody@x.test'] }, MESSAGE).catch(
			(caught: unknown) => caught
		);
		assert.ok(error instanceof SmtpError);
		assert.equal(error.code, 550);
		assert.match(error.message, /No such user/);
		assert.equal(server.log.some((entry) => entry.line === 'DATA'), false);
	});

	test('an address that could break the command line is refused', async () => {
		const server = fakeServer(relay);
		await assert.rejects(
			sendSmtp(server.connect, CONFIG, { from: 'me@example.com', to: ['a@x.test>\r\nRCPT TO:<evil@x.test'] }, MESSAGE),
			/Invalid address/
		);
		assert.equal(server.log.some((entry) => entry.line.includes('evil')), false);
	});

	test('a server that hangs up mid-conversation is an error, not a hang', async () => {
		const server = fakeServer((line, state) => (line.startsWith('MAIL') ? null : relay(line, state)));
		await assert.rejects(sendSmtp(server.connect, CONFIG, { from: 'me@example.com', to: ['a@x.test'] }, MESSAGE), /closed the connection/);
	});
});

describe('dotStuff', () => {
	test('doubles a leading dot and ends the message with CRLF', () => {
		assert.equal(dotStuff('.a\r\nb\r\n..c'), '..a\r\nb\r\n...c\r\n');
	});
});
