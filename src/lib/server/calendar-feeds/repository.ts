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
	sync_key: string | null;
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
	/** What the last full sync was computed from; see migration 0044. */
	syncKey: string | null;
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
		lastError: row.last_error,
		syncKey: row.sync_key
	};
}

const COLUMNS = 'id, user_id, name, url, color, event_count, last_synced_at, last_error, sync_key';

/**
 * Rows per statement. Each is one JSON element bound as a single parameter and
 * unpacked by `json_each`, so a big feed costs a handful of statements rather
 * than one per event — D1 caps statements per invocation, and bound
 * parameters per statement.
 */
const EVENTS_PER_STATEMENT = 400;

type StoredFeedEvent = {
	id: string;
	external_uid: string | null;
	title: string;
	starts_at: string;
	ends_at: string;
	all_day: number;
	location: string | null;
	busy: number;
};

type EventValues = {
	id: string;
	uid: string;
	title: string;
	start: string;
	end: string;
	allDay: 0 | 1;
	location: string | null;
	busy: 0 | 1;
};

export type FeedEventDiff = { insert: EventValues[]; update: EventValues[]; remove: string[] };

function unchanged(row: StoredFeedEvent, values: EventValues): boolean {
	return (
		row.title === values.title &&
		row.starts_at === values.start &&
		row.ends_at === values.end &&
		row.all_day === values.allDay &&
		row.location === values.location &&
		row.busy === values.busy
	);
}

/** Stored rows by uid; rows with no uid, or a uid already taken, are marked for removal. */
function indexStored(stored: StoredFeedEvent[]) {
	const byUid = new Map<string, StoredFeedEvent>();
	const remove: string[] = [];
	for (const row of stored) {
		if (row.external_uid === null || byUid.has(row.external_uid)) remove.push(row.id);
		else byUid.set(row.external_uid, row);
	}
	return { byUid, remove };
}

function toValues(event: FeedEvent, id: string): EventValues {
	return {
		id,
		uid: event.uid,
		title: event.title,
		start: event.start,
		end: event.end,
		allDay: event.allDay ? 1 : 0,
		location: event.location,
		busy: event.busy ? 1 : 0
	};
}

/**
 * What it takes to turn the stored events into `incoming`, matched on the
 * occurrence uid. D1 bills every row a statement touches, index entries
 * included, so a feed that has not changed must cost nothing.
 */
export function diffFeedEvents(
	stored: StoredFeedEvent[],
	incoming: FeedEvent[],
	newId: () => string = () => crypto.randomUUID()
): FeedEventDiff {
	const { byUid, remove } = indexStored(stored);

	const insert: EventValues[] = [];
	const update: EventValues[] = [];
	const seen = new Set<string>();
	for (const event of incoming) {
		if (seen.has(event.uid)) continue;
		seen.add(event.uid);

		const row = byUid.get(event.uid);
		const values = toValues(event, row?.id ?? newId());
		if (!row) insert.push(values);
		else if (!unchanged(row, values)) update.push(values);
	}

	for (const [uid, row] of byUid) if (!seen.has(uid)) remove.push(row.id);
	return { insert, update, remove };
}

function chunks<T>(list: T[]): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < list.length; index += EVENTS_PER_STATEMENT) {
		result.push(list.slice(index, index + EVENTS_PER_STATEMENT));
	}
	return result;
}

/** The outcome of a claimed sync; the attempt time was already written by `claim`. */
export type SyncRecord = {
	/** Set on success; the previous value is kept on failure. */
	syncedAt: string | null;
	error: string | null;
	eventCount: number | null;
	/** Kept when null, so a failed fetch doesn't force the next sync to redo everything. */
	syncKey: string | null;
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
	/** The same, for one user's feeds — the booking page refreshes its host's calendars. */
	listDueForUser(userId: string, before: string, limit: number): Promise<StoredFeed[]>;
	/**
	 * Marks a sync as started. With `staleBefore`, only if nobody has attempted
	 * one since then — so concurrent requests can't sync the same feed twice.
	 */
	claim(id: string, attemptedAt: string, staleBefore: string | null): Promise<boolean>;
	recordSync(id: string, record: SyncRecord): Promise<void>;
	/**
	 * Brings the feed's stored events in line with `events`, writing only what
	 * differs, in one batch so a reader never sees it half-written.
	 */
	syncEvents(userId: string, feedId: string, events: FeedEvent[]): Promise<void>;
	/** Which of `ids` are the user's own Zimail events (anything not from a feed). */
	ownEventIds(userId: string, ids: string[]): Promise<Set<string>>;
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

		async listDueForUser(userId, before, limit) {
			const { results } = await db
				.prepare(
					`SELECT ${COLUMNS} FROM calendar_feeds
					 WHERE user_id = ? AND (last_attempt_at IS NULL OR last_attempt_at < ?)
					 ORDER BY last_attempt_at IS NOT NULL, last_attempt_at LIMIT ?`
				)
				.bind(userId, before, limit)
				.all<FeedRow>();
			return results.map(toFeed);
		},

		async claim(id, attemptedAt, staleBefore) {
			const result = await db
				.prepare(
					`UPDATE calendar_feeds SET last_attempt_at = ?
					 WHERE id = ? AND (? IS NULL OR last_attempt_at IS NULL OR last_attempt_at < ?)`
				)
				.bind(attemptedAt, id, staleBefore, staleBefore)
				.run();
			return (result.meta.changes ?? 0) === 1;
		},

		async recordSync(id, record) {
			await db
				.prepare(
					`UPDATE calendar_feeds
					 SET last_error = ?,
					     last_synced_at = COALESCE(?, last_synced_at),
					     event_count = COALESCE(?, event_count),
					     sync_key = COALESCE(?, sync_key)
					 WHERE id = ?`
				)
				.bind(record.error, record.syncedAt, record.eventCount, record.syncKey, id)
				.run();
		},

		async ownEventIds(userId, ids) {
			if (ids.length === 0) return new Set();
			const { results } = await db
				.prepare(
					`SELECT id FROM calendar_events
					 WHERE user_id = ? AND source <> 'feed' AND id IN (SELECT value FROM json_each(?))`
				)
				.bind(userId, JSON.stringify(ids))
				.all<{ id: string }>();
			return new Set(results.map((row) => row.id));
		},

		async syncEvents(userId, feedId, events) {
			const { results } = await db
				.prepare(
					`SELECT id, external_uid, title, starts_at, ends_at, all_day, location, busy FROM calendar_events
					 WHERE user_id = ? AND source = 'feed' AND source_id = ?`
				)
				.bind(userId, feedId)
				.all<StoredFeedEvent>();
			const diff = diffFeedEvents(results, events);

			const statements: D1PreparedStatement[] = [];
			for (const ids of chunks(diff.remove)) {
				statements.push(
					db
						.prepare(
							`DELETE FROM calendar_events
							 WHERE user_id = ? AND source = 'feed' AND source_id = ? AND id IN (SELECT value FROM json_each(?))`
						)
						.bind(userId, feedId, JSON.stringify(ids))
				);
			}
			for (const rows of chunks(diff.update)) {
				statements.push(
					db
						.prepare(
							`UPDATE calendar_events
							 SET title = json_extract(j.value, '$.title'), starts_at = json_extract(j.value, '$.start'),
							     ends_at = json_extract(j.value, '$.end'), all_day = json_extract(j.value, '$.allDay'),
							     location = json_extract(j.value, '$.location'), busy = json_extract(j.value, '$.busy'),
							     updated_at = CURRENT_TIMESTAMP
							 FROM json_each(?) AS j
							 WHERE calendar_events.id = json_extract(j.value, '$.id')
							   AND calendar_events.user_id = ? AND calendar_events.source = 'feed' AND calendar_events.source_id = ?`
						)
						.bind(JSON.stringify(rows), userId, feedId)
				);
			}
			for (const rows of chunks(diff.insert)) {
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
			if (statements.length > 0) await db.batch(statements);
		}
	};
}
