import type { D1Database } from '@cloudflare/workers-types';
import type { PublishOptions } from '../../calendar/publish';

export type PublishedFeedRow = PublishOptions & {
	userId: string;
	/** The cached file; `null` once evicted, `''` while a rebuild is in flight. */
	ics: string | null;
	builtAt: string | null;
};

/** Raw D1 access for `calendar_publish`. No rules here — see `./service.ts`. */
export type CalendarPublishRepository = {
	options(userId: string): Promise<PublishOptions | null>;
	findByTokenHash(tokenHash: string): Promise<PublishedFeedRow | null>;
	/** Creates the row, or replaces its token (killing the old link) and drops the cache. */
	setToken(userId: string, tokenHash: string): Promise<void>;
	/** False when the user hasn't published. */
	setOptions(userId: string, options: PublishOptions): Promise<boolean>;
	remove(userId: string): Promise<void>;
	/**
	 * Marks a rebuild as started (`ics = ''`). An event write before
	 * `saveBuilt` clears the marker through the triggers, and the save then
	 * does nothing — so a file built from data that changed underneath it is
	 * never cached.
	 */
	markBuilding(userId: string): Promise<void>;
	saveBuilt(userId: string, ics: string, builtAt: string): Promise<void>;
};

type Row = {
	user_id: string;
	include_feeds: number;
	busy_only: number;
	ics: string | null;
	built_at: string | null;
};

export function createD1CalendarPublishRepository(db: D1Database): CalendarPublishRepository {
	return {
		async options(userId) {
			const row = await db
				.prepare('SELECT include_feeds, busy_only FROM calendar_publish WHERE user_id = ?')
				.bind(userId)
				.first<Pick<Row, 'include_feeds' | 'busy_only'>>();
			return row ? { includeFeeds: row.include_feeds === 1, busyOnly: row.busy_only === 1 } : null;
		},

		async findByTokenHash(tokenHash) {
			const row = await db
				.prepare('SELECT user_id, include_feeds, busy_only, ics, built_at FROM calendar_publish WHERE token_hash = ?')
				.bind(tokenHash)
				.first<Row>();
			if (!row) return null;
			return {
				userId: row.user_id,
				includeFeeds: row.include_feeds === 1,
				busyOnly: row.busy_only === 1,
				ics: row.ics,
				builtAt: row.built_at
			};
		},

		async setToken(userId, tokenHash) {
			await db
				.prepare(
					`INSERT INTO calendar_publish (user_id, token_hash) VALUES (?, ?)
					 ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, ics = NULL, built_at = NULL`
				)
				.bind(userId, tokenHash)
				.run();
		},

		async setOptions(userId, { includeFeeds, busyOnly }) {
			const result = await db
				.prepare(
					`UPDATE calendar_publish SET include_feeds = ?, busy_only = ?, ics = NULL, built_at = NULL
					 WHERE user_id = ?`
				)
				.bind(includeFeeds ? 1 : 0, busyOnly ? 1 : 0, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async remove(userId) {
			await db.prepare('DELETE FROM calendar_publish WHERE user_id = ?').bind(userId).run();
		},

		async markBuilding(userId) {
			await db
				.prepare(`UPDATE calendar_publish SET ics = '', built_at = NULL WHERE user_id = ?`)
				.bind(userId)
				.run();
		},

		async saveBuilt(userId, ics, builtAt) {
			await db
				.prepare(`UPDATE calendar_publish SET ics = ?, built_at = ? WHERE user_id = ? AND ics = ''`)
				.bind(ics, builtAt, userId)
				.run();
		}
	};
}
