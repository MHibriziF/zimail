import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { LABEL_COLORS, type LabelColor } from '../../mail/labels';
import type { FeedEvent } from '../../calendar/ics';

export type FeedRow = {
	id: string;
	user_id: string;
	name: string;
	url: string;
	color: string;
	event_count: number;
	last_synced_at: string | null;
	last_error: string | null;
};

export type StoredFeed = {
	id: string;
	userId: string;
	name: string;
	url: string;
	color: LabelColor;
	eventCount: number;
	lastSyncedAt: string | null;
	lastError: string | null;
};

function toFeed(row: FeedRow): StoredFeed {
	return {
		id: row.id,
		userId: row.user_id,
		name: row.name,
		url: row.url,
		color: LABEL_COLORS.find((color) => color === row.color) ?? 'blue',
		eventCount: row.event_count,
		lastSyncedAt: row.last_synced_at,
		lastError: row.last_error
	};
}

const COLUMNS = 'id, user_id, name, url, color, event_count, last_synced_at, last_error';

/**
 * Rows per INSERT. Each is one JSON element bound as a single parameter and
 * unpacked by `json_each`, so a big feed costs a handful of statements rather
 * than one per event — D1 caps statements per invocation, and bound
 * parameters per statement.
 */
const EVENTS_PER_STATEMENT = 400;

export type SyncRecord = {
	attemptedAt: string;
	/** Set on success; the previous value is kept on failure. */
	syncedAt: string | null;
	error: string | null;
	eventCount: number | null;
};

/** Raw D1 access for feeds, scoped by `user_id` except the cron's `listDue`. */
export type CalendarFeedsRepository = {
	listForUser(userId: string): Promise<StoredFeed[]>;
	countForUser(userId: string): Promise<number>;
	get(userId: string, id: string): Promise<StoredFeed | null>;
	insert(feed: { id: string; userId: string; name: string; url: string; color: LabelColor }): Promise<void>;
	update(userId: string, id: string, patch: { name?: string; color?: LabelColor }): Promise<boolean>;
	/** Removes the feed and every event it brought in. */
	delete(userId: string, id: string): Promise<boolean>;
	/** Feeds not attempted since `before`, oldest attempt first. */
	listDue(before: string, limit: number): Promise<StoredFeed[]>;
	recordSync(id: string, record: SyncRecord): Promise<void>;
	/** Swaps the feed's events for `events` in one batch, so a reader never sees it half-written. */
	replaceEvents(userId: string, feedId: string, events: FeedEvent[]): Promise<void>;
};

export function createD1CalendarFeedsRepository(db: D1Database): CalendarFeedsRepository {
	return {
		async listForUser(userId) {
			const { results } = await db
				.prepare(`SELECT ${COLUMNS} FROM calendar_feeds WHERE user_id = ? ORDER BY created_at`)
				.bind(userId)
				.all<FeedRow>();
			return results.map(toFeed);
		},

		async countForUser(userId) {
			const row = await db
				.prepare('SELECT COUNT(*) AS count FROM calendar_feeds WHERE user_id = ?')
				.bind(userId)
				.first<{ count: number }>();
			return row?.count ?? 0;
		},

		async get(userId, id) {
			const row = await db
				.prepare(`SELECT ${COLUMNS} FROM calendar_feeds WHERE id = ? AND user_id = ?`)
				.bind(id, userId)
				.first<FeedRow>();
			return row ? toFeed(row) : null;
		},

		async insert(feed) {
			await db
				.prepare('INSERT INTO calendar_feeds (id, user_id, name, url, color) VALUES (?, ?, ?, ?, ?)')
				.bind(feed.id, feed.userId, feed.name, feed.url, feed.color)
				.run();
		},

		async update(userId, id, patch) {
			const sets: string[] = [];
			const values: unknown[] = [];
			if (patch.name !== undefined) {
				sets.push('name = ?');
				values.push(patch.name);
			}
			if (patch.color !== undefined) {
				sets.push('color = ?');
				values.push(patch.color);
			}
			if (sets.length === 0) return false;
			const result = await db
				.prepare(`UPDATE calendar_feeds SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
				.bind(...values, id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async delete(userId, id) {
			const [, result] = await db.batch([
				db
					.prepare(`DELETE FROM calendar_events WHERE user_id = ? AND source = 'feed' AND source_id = ?`)
					.bind(userId, id),
				db.prepare('DELETE FROM calendar_feeds WHERE id = ? AND user_id = ?').bind(id, userId)
			]);
			return (result.meta.changes ?? 0) > 0;
		},

		async listDue(before, limit) {
			const { results } = await db
				.prepare(
					`SELECT ${COLUMNS} FROM calendar_feeds
					 WHERE last_attempt_at IS NULL OR last_attempt_at < ?
					 ORDER BY last_attempt_at IS NOT NULL, last_attempt_at LIMIT ?`
				)
				.bind(before, limit)
				.all<FeedRow>();
			return results.map(toFeed);
		},

		async recordSync(id, record) {
			await db
				.prepare(
					`UPDATE calendar_feeds
					 SET last_attempt_at = ?, last_error = ?,
					     last_synced_at = COALESCE(?, last_synced_at),
					     event_count = COALESCE(?, event_count)
					 WHERE id = ?`
				)
				.bind(record.attemptedAt, record.error, record.syncedAt, record.eventCount, id)
				.run();
		},

		async replaceEvents(userId, feedId, events) {
			const statements: D1PreparedStatement[] = [
				db
					.prepare(`DELETE FROM calendar_events WHERE user_id = ? AND source = 'feed' AND source_id = ?`)
					.bind(userId, feedId)
			];
			for (let index = 0; index < events.length; index += EVENTS_PER_STATEMENT) {
				const rows = events.slice(index, index + EVENTS_PER_STATEMENT).map((event) => ({
					id: crypto.randomUUID(),
					uid: event.uid,
					title: event.title,
					start: event.start,
					end: event.end,
					allDay: event.allDay ? 1 : 0,
					location: event.location,
					busy: event.busy ? 1 : 0
				}));
				statements.push(
					db
						.prepare(
							`INSERT INTO calendar_events
							 (id, user_id, source, source_id, external_uid, title, starts_at, ends_at, all_day, location, busy)
							 SELECT json_extract(value, '$.id'), ?, 'feed', ?, json_extract(value, '$.uid'),
							        json_extract(value, '$.title'), json_extract(value, '$.start'), json_extract(value, '$.end'),
							        json_extract(value, '$.allDay'), json_extract(value, '$.location'), json_extract(value, '$.busy')
							 FROM json_each(?)`
						)
						.bind(userId, feedId, JSON.stringify(rows))
				);
			}
			await db.batch(statements);
		}
	};
}
