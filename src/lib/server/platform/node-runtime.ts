import { runScheduledJobs } from '../jobs';
import { ensureSchema } from '../migrations/migrate';
import { createNodePlatform, type NodePlatform } from './node-platform';

/**
 * The self-hosted server's side of what Cloudflare provides: one platform for
 * the whole process, built from `process.env` and `DATA_DIR`, and the
 * once-a-minute jobs the cron trigger runs on Workers.
 *
 * The jobs are the same three indexed reads as the cron (scheduled send,
 * booking reminders, calendar feeds), 1,440 times a day on the owner's own
 * SQLite: no metered quota. A tick that finds the previous one still running is
 * skipped, so a slow calendar server can't pile runs up.
 */
export const JOB_INTERVAL_MS = 60_000;

export type NodeRuntime = { platform: NodePlatform; stop(): void };

export async function startNodeRuntime(
	vars: Record<string, string | undefined> = process.env,
	run: (platform: App.Platform) => Promise<void> = runScheduledJobs
): Promise<NodeRuntime> {
	const dataDir = vars.DATA_DIR?.trim() || './data';
	const platform = createNodePlatform({ dataDir, vars });
	// Migrate before the first request, so a fresh volume is ready on boot.
	await ensureSchema(platform.env.DB);

	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await run(platform);
		} catch (error) {
			// An unhandled rejection here would take the whole server down with it.
			console.error('scheduled jobs failed', error);
		} finally {
			running = false;
		}
	};
	const timer = setInterval(() => void tick(), JOB_INTERVAL_MS);
	// The timer alone shouldn't keep a process alive that is otherwise shutting down.
	(timer as { unref?: () => void }).unref?.();
	void tick();

	console.log(`zimail: data in ${dataDir}, jobs every ${JOB_INTERVAL_MS / 1000}s`);
	return {
		platform,
		stop() {
			clearInterval(timer);
			platform.close();
		}
	};
}
