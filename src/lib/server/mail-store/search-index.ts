import type { D1Database } from '@cloudflare/workers-types';

/**
 * Indexes the mail that existed before the full-text index (migration 0061),
 * a batch at a time from the minute cron. New mail is indexed by triggers as
 * it arrives; until this finishes, search keeps using the LIKE scan.
 *
 * Cost: a batch every ten minutes, BATCH messages each, is at most
 * 144 × 30 = 4,320 messages a day, about 5 rows written per message
 * (≈ 22,000 of D1's 100,000 free daily writes). Once done, it is one
 * state read every ten minutes.
 */
export const BACKFILL_BATCH = 30;
export const BACKFILL_EVERY_MINUTES = 10;

/** Must index exactly what the triggers in 0061 do, or old and new mail would search differently. */
const INDEXED_COLUMNS = `rowid, id, subject,
	COALESCE(from_name, '') || ' ' || from_addr,
	to_addr || ' ' || COALESCE(cc_addr, ''),
	substr(COALESCE(body_text, ''), 1, 20000)`;

type State = { backfill_max: number; cursor: number; ready: number };

export type BackfillResult = { indexed: number; done: boolean };

/** One batch, or null when it isn't this run's turn, the index is complete, or it doesn't exist. */
export async function runSearchIndexBackfill(db: D1Database, now = new Date()): Promise<BackfillResult | null> {
	if (now.getUTCMinutes() % BACKFILL_EVERY_MINUTES !== 0) return null;
	const state = await db
		.prepare('SELECT backfill_max, cursor, ready FROM search_index_state WHERE id = 1')
		.first<State>()
		.catch(() => null);
	if (!state || state.ready === 1) return null;

	// The last rowid of this batch; rowids are only ever compared, so gaps from deleted mail don't matter.
	const batch = await db
		.prepare(
			`SELECT MAX(rowid) AS upto, COUNT(*) AS count FROM (
				SELECT rowid FROM emails WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?
			)`
		)
		.bind(state.cursor, state.backfill_max, BACKFILL_BATCH)
		.first<{ upto: number | null; count: number }>();

	if (!batch?.upto) {
		await db.prepare('UPDATE search_index_state SET cursor = backfill_max, ready = 1 WHERE id = 1').run();
		return { indexed: 0, done: true };
	}

	const done = batch.upto >= state.backfill_max;
	// OR REPLACE: a message edited since the migration was already put in by its trigger.
	await db.batch([
		db
			.prepare(
				`INSERT OR REPLACE INTO emails_fts (rowid, email_id, subject, sender, recipients, body)
				 SELECT ${INDEXED_COLUMNS} FROM emails
				 WHERE rowid > ? AND rowid <= ? AND status IS NOT 'draft'`
			)
			.bind(state.cursor, batch.upto),
		db.prepare('UPDATE search_index_state SET cursor = ?, ready = ? WHERE id = 1').bind(batch.upto, done ? 1 : 0)
	]);
	return { indexed: batch.count, done };
}
