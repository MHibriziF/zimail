import { getEmailProvider } from './context';
import { ensureSchema } from './migrations/migrate';
import { runDueBookingReminders } from './reservations';
import { runDueScheduledSends } from './scheduled-send';
import { runDueFeedSyncs } from './calendar-feeds';

/**
 * The once-a-minute work: what the Worker's cron trigger runs, and what the
 * self-hosted server runs on its own timer. Each step is a single indexed
 * read when nothing is due.
 *
 * Failures are logged and swallowed. A step that throws must not hold up the
 * others, and every message has already been counted against its own attempt
 * limit.
 */
export async function runScheduledJobs(platform: App.Platform): Promise<void> {
	const { env } = platform;
	try {
		await ensureSchema(env.DB);
		const provider = getEmailProvider(platform);
		const { sent, failed } = await runDueScheduledSends({ DB: env.DB, ATTACHMENTS: env.ATTACHMENTS }, provider);
		if (sent || failed) {
			console.log(`scheduled send: ${sent} sent, ${failed} failed`);
		}
	} catch (error) {
		console.error('scheduled send sweep failed', error);
	}
	// One indexed read a minute, nearly always empty; its own step so a failure can't hold up mail.
	try {
		const { sent, skipped } = await runDueBookingReminders(platform);
		if (sent || skipped) console.log(`booking reminders: ${sent} sent, ${skipped} skipped`);
	} catch (error) {
		console.error('booking reminder sweep failed', error);
	}
	// Separate from the send sweep so a slow calendar server never delays mail.
	try {
		const { synced, failed } = await runDueFeedSyncs(env.DB);
		if (synced || failed) console.log(`calendar feeds: ${synced} synced, ${failed} failed`);
	} catch (error) {
		console.error('calendar feed sync failed', error);
	}
}
