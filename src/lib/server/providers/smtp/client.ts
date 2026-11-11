/**
 * Just enough SMTP (RFC 5321) to hand one message to a relay: EHLO, STARTTLS,
 * AUTH PLAIN or LOGIN, MAIL/RCPT/DATA. It runs over `SmtpSocket`, so the same
 * code works on Workers (`cloudflare:sockets`) and on Node or Bun (`node:tls`).
 */

export type SmtpSocket = {
	write(data: Uint8Array): Promise<void>;
	/** The next chunk from the server; `null` once it hangs up. */
	read(): Promise<Uint8Array | null>;
	/** STARTTLS: the same connection, now encrypted. The old socket is done. */
	upgrade(): Promise<SmtpSocket>;
	close(): Promise<void>;
};

/** `tls`: TLS from the first byte (465). `starttls`: plain, then upgraded (587). `none`: never encrypted. */
export type SmtpSecurity = 'tls' | 'starttls' | 'none';

export type SmtpConnect = (options: { host: string; port: number; security: SmtpSecurity }) => Promise<SmtpSocket>;

export type SmtpConfig = {
	host: string;
	port: number;
	security: SmtpSecurity;
	user?: string;
	password?: string;
	/** What we call ourselves in EHLO. */
	clientName: string;
	timeoutMs?: number;
};

export type SmtpEnvelope = { from: string; to: string[] };

/** A reply from the server that ended the conversation, with its code. */
export class SmtpError extends Error {
	readonly code: number;
	constructor(code: number, message: string) {
		super(message);
		this.name = 'SmtpError';
		this.code = code;
	}
}

type Reply = { code: number; lines: string[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new SmtpError(421, `SMTP server did not answer ${what} within ${ms / 1000}s`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A line starting with a dot gets another, so it can't end DATA early (RFC 5321 §4.5.2). */
export function dotStuff(message: string): string {
	const body = message.endsWith('\r\n') ? message : `${message}\r\n`;
	return body
		.split('\r\n')
		.map((line) => (line.startsWith('.') ? `.${line}` : line))
		.join('\r\n');
}

/** Envelope addresses go inside `<...>`; anything that could break the command line is refused. */
function envelopeAddress(address: string): string {
	const trimmed = address.trim();
	if (!trimmed || /[\s<>]/.test(trimmed)) throw new SmtpError(501, `Invalid address: ${address}`);
	return `<${trimmed}>`;
}

function base64(value: string): string {
	let binary = '';
	for (const byte of encoder.encode(value)) binary += String.fromCodePoint(byte);
	return btoa(binary);
}

class Session {
	private buffer = '';
	private socket: SmtpSocket;
	private readonly timeoutMs: number;

	constructor(socket: SmtpSocket, timeoutMs: number) {
		this.socket = socket;
		this.timeoutMs = timeoutMs;
	}

	private async nextLine(what: string): Promise<string> {
		for (;;) {
			const end = this.buffer.indexOf('\r\n');
			if (end >= 0) {
				const line = this.buffer.slice(0, end);
				this.buffer = this.buffer.slice(end + 2);
				return line;
			}
			const chunk = await withTimeout(this.socket.read(), this.timeoutMs, what);
			if (chunk === null) throw new SmtpError(421, `SMTP server closed the connection during ${what}`);
			this.buffer += decoder.decode(chunk, { stream: true });
		}
	}

	/** One reply, which may span `250-...` continuation lines. */
	async reply(what: string): Promise<Reply> {
		const lines: string[] = [];
		for (;;) {
			const line = await this.nextLine(what);
			const code = Number(line.slice(0, 3));
			if (!Number.isInteger(code) || code < 200) throw new SmtpError(500, `Unexpected SMTP reply to ${what}: ${line}`);
			lines.push(line.slice(4));
			if (line[3] !== '-') return { code, lines };
		}
	}

	async expect(what: string, ...codes: number[]): Promise<Reply> {
		const reply = await this.reply(what);
		if (!codes.includes(reply.code)) throw new SmtpError(reply.code, `SMTP ${what} failed: ${reply.code} ${reply.lines.join(' ')}`);
		return reply;
	}

	async send(line: string): Promise<void> {
		await this.socket.write(encoder.encode(`${line}\r\n`));
	}

	async command(line: string, what: string, ...codes: number[]): Promise<Reply> {
		await this.send(line);
		return this.expect(what, ...codes);
	}

	async writeRaw(data: string): Promise<void> {
		await this.socket.write(encoder.encode(data));
	}

	async upgrade(): Promise<void> {
		this.socket = await this.socket.upgrade();
		this.buffer = '';
	}

	close(): Promise<void> {
		return this.socket.close().catch(() => undefined);
	}
}

function capabilities(reply: Reply): Set<string> {
	return new Set(reply.lines.map((line) => line.toUpperCase()));
}

function authMechanisms(caps: Set<string>): string[] {
	for (const cap of caps) {
		if (cap.startsWith('AUTH ') || cap.startsWith('AUTH=')) return cap.slice(5).split(/\s+/);
	}
	return [];
}

async function authenticate(session: Session, caps: Set<string>, user: string, password: string): Promise<void> {
	const mechanisms = authMechanisms(caps);
	if (mechanisms.includes('PLAIN')) {
		await session.command(`AUTH PLAIN ${base64(`\u0000${user}\u0000${password}`)}`, 'AUTH', 235);
		return;
	}
	if (mechanisms.includes('LOGIN')) {
		await session.command('AUTH LOGIN', 'AUTH', 334);
		await session.command(base64(user), 'AUTH', 334);
		await session.command(base64(password), 'AUTH', 235);
		return;
	}
	throw new SmtpError(504, 'SMTP server offers neither AUTH PLAIN nor AUTH LOGIN');
}

/** Sends one message. Resolves with the server's reply to the end of DATA, which usually names its queue id. */
export async function sendSmtp(
	connect: SmtpConnect,
	config: SmtpConfig,
	envelope: SmtpEnvelope,
	message: string
): Promise<string> {
	const wantsAuth = Boolean(config.user);
	if (wantsAuth && config.security === 'none') {
		throw new SmtpError(530, 'Refusing to send the SMTP password over an unencrypted connection (SMTP_SECURITY=none)');
	}
	if (envelope.to.length === 0) throw new SmtpError(554, 'No recipients');

	const session = new Session(await connect(config), config.timeoutMs ?? 30_000);
	try {
		await session.expect('greeting', 220);
		let caps = capabilities(await session.command(`EHLO ${config.clientName}`, 'EHLO', 250));

		if (config.security === 'starttls') {
			// Never fall back to plain text: a relay without STARTTLS here is a misconfiguration or an attack.
			if (!caps.has('STARTTLS')) throw new SmtpError(530, 'SMTP server does not offer STARTTLS');
			await session.command('STARTTLS', 'STARTTLS', 220);
			await session.upgrade();
			caps = capabilities(await session.command(`EHLO ${config.clientName}`, 'EHLO', 250));
		}

		if (wantsAuth) await authenticate(session, caps, config.user ?? '', config.password ?? '');

		await session.command(`MAIL FROM:${envelopeAddress(envelope.from)}`, 'MAIL FROM', 250);
		// One RCPT per address even when it's in To and Cc; the local part's case is kept, as RFC 5321 asks.
		const recipients = new Map(envelope.to.map((address) => [address.trim().toLowerCase(), address.trim()]));
		for (const recipient of recipients.values()) {
			await session.command(`RCPT TO:${envelopeAddress(recipient)}`, `RCPT TO ${recipient}`, 250, 251);
		}
		await session.command('DATA', 'DATA', 354);
		await session.writeRaw(`${dotStuff(message)}.\r\n`);
		const accepted = await session.expect('message', 250);

		await session.send('QUIT').catch(() => undefined);
		return accepted.lines.join(' ');
	} finally {
		await session.close();
	}
}
