import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { deleteEmailsPermanently } from './mail-store';
import { SWEEP_AGE_CHOICES, TRASH_RETENTION_CHOICES } from '$lib/cleanup-options';

export { TRASH_RETENTION_CHOICES, SWEEP_AGE_CHOICES } from '$lib/cleanup-options';
/** One sweep cannot run away with the whole mailbox in a single request. */
const SWEEP_BATCH_LIMIT = 500;

export type SweepFilter = {
	olderThanDays: number;
	/** Leave anything still unread — the usual reason to keep an old message. */
	onlyRead: boolean;
	keepStarred: boolean;
};

/**
 * Builds the shared WHERE for a sweep.
 *
 * Drafts and scheduled messages are never swept: neither has been sent, and
 * losing one to a date filter would destroy unsent writing.
 */
function sweepWhere(filter: SweepFilter): { sql: string; bindings: unknown[] } {
	const clauses = [
		'user_id = ?',
		'deleted_at IS NULL',
		"(status IS NULL OR status NOT IN ('draft', 'scheduled'))",
		"created_at < datetime('now', ?)"
	];
	const bindings: unknown[] = [`-${Math.max(1, Math.floor(filter.olderThanDays))} days`];

	if (filter.onlyRead) clauses.push('is_read = 1');
	if (filter.keepStarred) clauses.push('is_starred = 0');

	return { sql: clauses.join(' AND '), bindings };
}

/** How many messages a sweep would move. Shown before anything is touched. */
export async function countSweepCandidates(
	db: D1Database,
	userId: string,
	filter: SweepFilter
): Promise<number> {
	const { sql, bindings } = sweepWhere(filter);
	const row = await db
		.prepare(`SELECT COUNT(*) AS count FROM emails WHERE ${sql}`)
		.bind(userId, ...bindings)
		.first<{ count: number }>();

	return row?.count ?? 0;
}

/**
 * Moves old mail to the trash rather than deleting it.
 *
 * A date filter is a blunt instrument, so the result stays recoverable; the
 * retention setting is what eventually makes it permanent.
 */
export async function sweepOldMail(
	db: D1Database,
	userId: string,
	filter: SweepFilter
): Promise<number> {
	const { sql, bindings } = sweepWhere(filter);
	const result = await db
		.prepare(
			`UPDATE emails SET deleted_at = datetime('now')
			  WHERE id IN (SELECT id FROM emails WHERE ${sql} LIMIT ${SWEEP_BATCH_LIMIT})`
		)
		.bind(userId, ...bindings)
		.run();

	return result.meta.changes ?? 0;
}

/** Permanently removes trash deleted longer ago than `days`, attachments too. */
export async function purgeExpiredTrash(
	db: D1Database,
	bucket: R2Bucket | undefined,
	userId: string,
	days: number
): Promise<number> {
	if (days <= 0) return 0;

	const { results } = await db
		.prepare(
			`SELECT id FROM emails
			  WHERE user_id = ? AND deleted_at IS NOT NULL
			    AND deleted_at < datetime('now', ?)
			  LIMIT ${SWEEP_BATCH_LIMIT}`
		)
		.bind(userId, `-${Math.floor(days)} days`)
		.all<{ id: string }>();

	if (results.length === 0) return 0;

	return deleteEmailsPermanently(
		db,
		bucket,
		userId,
		results.map((row) => row.id)
	);
}

/** The saved sweep filter, and whether the daily cleanup applies it by itself. */
export type SweepSettings = SweepFilter & { auto: boolean };
export type CleanupSettings = { trashRetentionDays: number; sweep: SweepSettings };

export const DEFAULT_CLEANUP_SETTINGS: CleanupSettings = {
	trashRetentionDays: 0,
	sweep: { auto: false, olderThanDays: 90, onlyRead: true, keepStarred: true }
};

type SettingsRow = {
	trash_retention_days: number;
	sweep_auto: number;
	sweep_days: number;
	sweep_only_read: number;
	sweep_keep_starred: number;
};

export async function getCleanupSettings(
	db: D1Database,
	userId: string
): Promise<CleanupSettings> {
	const row = await db
		.prepare(
			`SELECT trash_retention_days, sweep_auto, sweep_days, sweep_only_read, sweep_keep_starred
			   FROM users WHERE id = ?`
		)
		.bind(userId)
		.first<SettingsRow>();
	if (!row) return DEFAULT_CLEANUP_SETTINGS;

	return {
		trashRetentionDays: row.trash_retention_days,
		sweep: {
			auto: row.sweep_auto === 1,
			olderThanDays: row.sweep_days,
			onlyRead: row.sweep_only_read === 1,
			keepStarred: row.sweep_keep_starred === 1
		}
	};
}

export function isRetentionChoice(days: number): boolean {
	return TRASH_RETENTION_CHOICES.includes(days as (typeof TRASH_RETENTION_CHOICES)[number]);
}

export function isSweepAgeChoice(days: number): boolean {
	return SWEEP_AGE_CHOICES.includes(days as (typeof SWEEP_AGE_CHOICES)[number]);
}

/** Saves the whole form in one write. Only the offered periods are accepted. */
export async function saveCleanupSettings(
	db: D1Database,
	userId: string,
	settings: CleanupSettings
): Promise<void> {
	if (!isRetentionChoice(settings.trashRetentionDays)) {
		throw new Error('Pick one of the offered retention periods');
	}
	if (!isSweepAgeChoice(settings.sweep.olderThanDays)) {
		throw new Error('Pick one of the offered ages');
	}

	await db
		.prepare(
			`UPDATE users SET trash_retention_days = ?, sweep_auto = ?, sweep_days = ?,
			                  sweep_only_read = ?, sweep_keep_starred = ?
			  WHERE id = ?`
		)
		.bind(
			settings.trashRetentionDays,
			settings.sweep.auto ? 1 : 0,
			settings.sweep.olderThanDays,
			settings.sweep.onlyRead ? 1 : 0,
			settings.sweep.keepStarred ? 1 : 0,
			userId
		)
		.run();
}

/**
 * Runs the automatic cleanup, at most once a day: the saved sweep when it's switched on,
 * then emptying Trash past its retention. Mail the sweep moves is stamped now, so it is
 * never purged in the same run.
 *
 * The claim and the throttle are the same UPDATE, so two requests arriving
 * together cannot both decide it is their turn. A user with neither turned on
 * matches nothing, so nothing is written.
 */
export async function runDueCleanup(
	db: D1Database,
	bucket: R2Bucket | undefined,
	userId: string
): Promise<{ moved: number; removed: number }> {
	const claim = await db
		.prepare(
			`UPDATE users SET last_trash_purge_at = datetime('now')
			  WHERE id = ? AND (trash_retention_days > 0 OR sweep_auto = 1)
			    AND (last_trash_purge_at IS NULL
			         OR last_trash_purge_at < datetime('now', '-1 day'))`
		)
		.bind(userId)
		.run();

	if ((claim.meta.changes ?? 0) !== 1) return { moved: 0, removed: 0 };

	const { trashRetentionDays, sweep } = await getCleanupSettings(db, userId);
	const moved = sweep.auto ? await sweepOldMail(db, userId, sweep) : 0;
	const removed = await purgeExpiredTrash(db, bucket, userId, trashRetentionDays);
	return { moved, removed };
}
