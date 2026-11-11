import type { SmtpConnect, SmtpSecurity, SmtpSocket } from './client';

/**
 * TCP for the SMTP client: `cloudflare:sockets` in a Worker, `node:net` and
 * `node:tls` on Node or Bun. Both are imported by a computed name, so each
 * build leaves the other runtime's module alone, the same trick the tests use
 * for `bun:sqlite`.
 */

type WorkersSocket = {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	startTls(): WorkersSocket;
	close(): Promise<void>;
};
type WorkersSockets = {
	connect(address: { hostname: string; port: number }, options: { secureTransport: 'on' | 'off' | 'starttls'; allowHalfOpen: boolean }): WorkersSocket;
};

const SECURE_TRANSPORT: Record<SmtpSecurity, 'on' | 'off' | 'starttls'> = { tls: 'on', starttls: 'starttls', none: 'off' };

function workersSocket(socket: WorkersSocket): SmtpSocket {
	const reader = socket.readable.getReader();
	const writer = socket.writable.getWriter();
	return {
		write: (data) => writer.write(data),
		async read() {
			const { value, done } = await reader.read();
			return done ? null : value;
		},
		async upgrade() {
			reader.releaseLock();
			writer.releaseLock();
			return workersSocket(socket.startTls());
		},
		close: () => socket.close()
	};
}

const connectWorkers: SmtpConnect = async ({ host, port, security }) => {
	const name = 'cloudflare:sockets';
	const { connect } = (await import(/* @vite-ignore */ name)) as WorkersSockets;
	return workersSocket(connect({ hostname: host, port }, { secureTransport: SECURE_TRANSPORT[security], allowHalfOpen: false }));
};

type NodeStream = {
	on(event: 'data', listener: (chunk: Uint8Array) => void): void;
	on(event: 'end' | 'close', listener: () => void): void;
	on(event: 'error', listener: (error: Error) => void): void;
	once(event: string, listener: (...args: unknown[]) => void): void;
	write(data: Uint8Array, callback: (error?: Error | null) => void): void;
	removeAllListeners(): void;
	end(): void;
	destroy(): void;
};
type NodeTls = { connect(options: Record<string, unknown>): NodeStream };
type NodeNet = { connect(options: { host: string; port: number }): NodeStream };

/** Turns Node's events into the pull-based `read()` the client wants. */
function nodeSocket(stream: NodeStream, upgradeTo: (raw: NodeStream) => Promise<NodeStream>): SmtpSocket {
	const chunks: (Uint8Array | null)[] = [];
	const waiting: ((chunk: Uint8Array | null) => void)[] = [];
	let failure: Error | null = null;

	const push = (chunk: Uint8Array | null) => {
		const next = waiting.shift();
		if (next) next(chunk);
		else chunks.push(chunk);
	};
	stream.on('data', (chunk) => push(chunk));
	stream.on('end', () => push(null));
	stream.on('close', () => push(null));
	stream.on('error', (error) => {
		failure = error;
		push(null);
	});

	return {
		write: (data) =>
			new Promise((resolve, reject) => stream.write(data, (error) => (error ? reject(error) : resolve()))),
		async read() {
			if (failure) throw failure;
			if (chunks.length > 0) return chunks.shift() ?? null;
			const chunk = await new Promise<Uint8Array | null>((resolve) => waiting.push(resolve));
			if (failure) throw failure;
			return chunk;
		},
		async upgrade() {
			stream.removeAllListeners();
			return nodeSocket(await upgradeTo(stream), upgradeTo);
		},
		async close() {
			stream.end();
			stream.destroy();
		}
	};
}

function whenConnected(stream: NodeStream, event: 'connect' | 'secureConnect'): Promise<NodeStream> {
	return new Promise((resolve, reject) => {
		stream.once(event, () => resolve(stream));
		stream.once('error', (error) => reject(error as Error));
	});
}

const connectNode: SmtpConnect = async ({ host, port, security }) => {
	const tlsName = 'node:tls';
	const netName = 'node:net';
	const tls = (await import(/* @vite-ignore */ tlsName)) as NodeTls;
	const upgradeTo = (raw: NodeStream) => whenConnected(tls.connect({ socket: raw, servername: host }), 'secureConnect');

	if (security === 'tls') {
		return nodeSocket(await whenConnected(tls.connect({ host, port, servername: host }), 'secureConnect'), upgradeTo);
	}
	const net = (await import(/* @vite-ignore */ netName)) as NodeNet;
	return nodeSocket(await whenConnected(net.connect({ host, port }), 'connect'), upgradeTo);
};

function isWorkers(): boolean {
	return globalThis.navigator?.userAgent === 'Cloudflare-Workers';
}

export const connectSmtp: SmtpConnect = (options) => (isWorkers() ? connectWorkers(options) : connectNode(options));
