import { json, type RequestHandler } from '@sveltejs/kit';
import { aiFromEnv } from '$lib/server/ai/provider';
import { handleRawInbound } from '$lib/server/inbound/raw-mime';
import { readRawInbound } from '$lib/server/inbound/raw-webhook';

/**
 * Inbound mail as raw MIME, from any MX or provider: see `raw-webhook.ts` for
 * the formats. Off until `INBOUND_WEBHOOK_SECRET` is set, and then it answers
 * 404 to anyone without it as well, so it can't be probed.
 *
 * Retries are safe: the pipeline skips a Message-ID it has already stored.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	const secret = platform?.env.INBOUND_WEBHOOK_SECRET?.trim();
	if (!secret) return json({ error: 'Not found' }, { status: 404 });

	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket) return json({ error: 'Storage unavailable' }, { status: 503 });

	const outcome = await readRawInbound(request, secret);
	if (outcome.kind === 'unauthorized') return json({ error: 'Not found' }, { status: 404 });
	if (outcome.kind === 'too_large') return json({ error: 'Message too large' }, { status: 413 });
	if (outcome.kind === 'invalid') return json({ error: outcome.reason }, { status: 400 });

	try {
		await handleRawInbound(outcome.message, {
			DB: db,
			ATTACHMENTS: bucket,
			AI: aiFromEnv(platform?.env) ?? undefined,
			VAPID_PUBLIC_KEY: platform?.env.VAPID_PUBLIC_KEY,
			VAPID_PRIVATE_KEY: platform?.env.VAPID_PRIVATE_KEY,
			VAPID_SUBJECT: platform?.env.VAPID_SUBJECT,
			TELEGRAM_BOT_TOKEN: platform?.env.TELEGRAM_BOT_TOKEN,
			TELEGRAM_CHAT_ID: platform?.env.TELEGRAM_CHAT_ID,
			TELEGRAM_THREAD_ID: platform?.env.TELEGRAM_THREAD_ID,
			APP_URL: platform?.env.APP_URL,
			waitUntil: platform?.ctx ? (promise) => platform.ctx.waitUntil(promise) : undefined
		});
		return json({ ok: true });
	} catch (error) {
		// A 5xx makes the sender retry, which is what we want for a transient failure.
		console.error('Raw inbound webhook failed', error);
		return json({ error: 'Could not store the message' }, { status: 500 });
	}
};
