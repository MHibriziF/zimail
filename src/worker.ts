import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import {
	handleCloudflareInbound,
	type CloudflareInboundEnv,
	type CloudflareInboundMessage
} from './lib/server/inbound/cloudflare-inbound';
import { getEmailProvider } from './lib/server/context';
import { ensureSchema } from './lib/server/migrations/migrate';
import { runDueScheduledSends } from './lib/server/scheduled-send';
// Renamed from `_worker.js` by `scripts/wrap-cloudflare-worker.mjs` after `vite build`.
// Whether this resolves depends on whether a build exists, so the suppression has
// to be @ts-ignore: @ts-expect-error itself becomes an error once one does.
// @ts-ignore file is created at build time
import sveltekit from '../.svelte-kit/cloudflare/_sveltekit.js';

type SvelteKitWorker = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
};

const svelteApp = sveltekit as SvelteKitWorker;

/**
 * SvelteKit's generated Worker is fetch-only. This wrapper keeps HTTP on
 * SvelteKit and adds the handlers it cannot express: Cloudflare Email
 * Service's `email()` and the cron trigger that sends scheduled mail.
 */
export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (typeof svelteApp.fetch !== 'function') {
			throw new Error('SvelteKit worker export is missing fetch');
		}
		return svelteApp.fetch(request, env, ctx);
	},

	async email(message: CloudflareInboundMessage, env: Env, ctx: ExecutionContext) {
		if (env.EMAIL_PROVIDER?.trim().toLowerCase() !== 'cloudflare') {
			message.setReject('Cloudflare email provider is not enabled');
			return;
		}

		// Inbound mail can be the first thing a fresh deploy ever sees.
		await ensureSchema(env.DB);

		const inboundEnv: CloudflareInboundEnv = {
			DB: env.DB,
			ATTACHMENTS: env.ATTACHMENTS,
			VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
			VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
			VAPID_SUBJECT: env.VAPID_SUBJECT,
			TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
			TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
			TELEGRAM_THREAD_ID: env.TELEGRAM_THREAD_ID,
			APP_URL: env.APP_URL,
			waitUntil: (promise) => ctx.waitUntil(promise)
		};

		await handleCloudflareInbound(message, inboundEnv);
	},

	/**
	 * Cron trigger — see `triggers.crons` in wrangler.jsonc.
	 *
	 * Scheduled mail waits in D1 rather than at the provider, so this is what
	 * actually delivers it. Failures are swallowed: a trigger that throws is
	 * retried by the platform, and every message has already been counted
	 * against its own attempt limit.
	 */
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(
			(async () => {
				try {
					await ensureSchema(env.DB);
					const provider = getEmailProvider({ env, ctx });
					const { sent, failed } = await runDueScheduledSends(
						{ DB: env.DB, ATTACHMENTS: env.ATTACHMENTS },
						provider
					);
					if (sent || failed) {
						console.log(`scheduled send: ${sent} sent, ${failed} failed`);
					}
				} catch (error) {
					console.error('scheduled send sweep failed', error);
				}
			})()
		);
	}
};
