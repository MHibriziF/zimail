export const RAW_INBOUND_PATH = '/api/webhooks/inbound';

/**
 * SvelteKit refuses cross-site form posts (multipart, urlencoded, text/plain)
 * as CSRF, and SendGrid and Mailgun post multipart with no `Origin` at all. CSRF
 * is about a browser's cookies riding along, and this route authenticates with
 * its own secret and never reads a cookie. So for exactly this route, the
 * request reaches SvelteKit as same-origin with its cookies removed, and every
 * other route keeps the check.
 */
export function asWebhookRequest(request: Request): Request {
	if (request.method !== 'POST') return request;
	const url = new URL(request.url);
	if (url.pathname !== RAW_INBOUND_PATH) return request;

	const headers = new Headers(request.headers);
	headers.set('origin', url.origin);
	headers.delete('cookie');
	return new Request(request, { headers });
}
