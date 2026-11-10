import type { MailFlagUpdate } from './repository';

/**
 * Where a message lives. Inbox, Archive and Spam are places, and a message is
 * in one of them. Trash sits on top of any place, and restoring a message puts
 * it back where it was. Starred is a mark, not a place, so it survives every
 * move (Starred hides spam, so a starred spam message shows up again when it
 * leaves Spam).
 *
 * - Spam takes a message out of Archive, so "Not spam" lands it in the inbox.
 * - Archiving a message that is in Spam leaves it in Spam. "Not spam" is the
 *   only way out, because it also unblocks the sender.
 */
export function withLocationRules(update: MailFlagUpdate): MailFlagUpdate {
	if (update.spam) return { ...update, archived: false };
	return update;
}

const WHEN_SCHEDULED = "CASE WHEN status = 'scheduled'";

/**
 * Trashing a scheduled message cancels the send, the same way
 * `cancelScheduledSend` does, so restoring it gives back a draft. Otherwise a
 * message restored after its time would go out on the next cron tick. Every
 * `CASE` reads the row's old `status`, so they all see `'scheduled'`.
 */
export const TRASH_CANCELS_SCHEDULE = [
	`status = ${WHEN_SCHEDULED} THEN 'draft' ELSE status END`,
	`scheduled_at = ${WHEN_SCHEDULED} THEN NULL ELSE scheduled_at END`,
	`send_attempts = ${WHEN_SCHEDULED} THEN 0 ELSE send_attempts END`,
	`status_detail = ${WHEN_SCHEDULED} THEN NULL ELSE status_detail END`,
	`status_at = ${WHEN_SCHEDULED} THEN datetime('now') ELSE status_at END`
] as const;
