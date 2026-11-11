// The self-hosted server: `bun run build:node`, then `bun server/node.js`.
// SvelteKit's `init` hook (src/hooks.server.ts) opens the SQLite database and
// the blobs folder under DATA_DIR, migrates, and starts the minute timer.
import { createServer } from 'node:http';
import { handler } from '../build/handler.js';

const INBOUND_WEBHOOK = '/api/webhooks/inbound';
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const origin = process.env.ORIGIN?.replace(/\/+$/, '');

/**
 * The same exemption the Worker makes in src/lib/server/inbound/webhook-request.ts:
 * SvelteKit refuses cross-site form posts before any hook runs, and SendGrid
 * and Mailgun post multipart with no Origin. That route authenticates with its
 * own secret, so it is presented as same-origin with its cookies removed.
 */
function asWebhookRequest(req) {
	if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== INBOUND_WEBHOOK) return;
	req.headers.origin = origin ?? `http://${req.headers.host}`;
	delete req.headers.cookie;
}

const server = createServer((req, res) => {
	asWebhookRequest(req);
	handler(req, res);
});

server.listen(port, host, () => console.log(`zimail: listening on http://${host}:${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
