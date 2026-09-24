import type { D1Database } from '@cloudflare/workers-types';
import { PART_STATS, type PartStat } from '../../calendar/ics/invite';

/** What the user did with one invitation (by UID), kept so later updates can be applied. */
export type StoredInvite = {
	uid: string;
	sequence: number;
	/** `null` until answered; an invitation added without answering stays `null`. */
	response: PartStat | null;
};

/** One occurrence as stored in calendar_events (source 'invite', source_id = the UID). */
export type InviteEventRow = {
	id: string;
	externalUid: string;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	busy: boolean;
};

/**
 * Raw D1 access for invitations the user received. No rules here — see
 * `./service.ts`. Events live in calendar_events under source 'invite'.
 */
export type InvitationsRepository = {
	get(userId: string, uid: string): Promise<StoredInvite | null>;
	save(userId: string, invite: StoredInvite): Promise<void>;
	/** Whether any occurrence of the invitation is on the calendar. */
	hasEvents(userId: string, uid: string): Promise<boolean>;
	/** Swaps every stored occurrence of `uid` for `events` in one batch. */
	replaceEvents(userId: string, uid: string, events: InviteEventRow[]): Promise<void>;
	/** Swaps one occurrence (by its id within the series) for `event`, or just drops it. */
	replaceOccurrence(userId: string, uid: string, externalUid: string, event: InviteEventRow | null): Promise<void>;
	removeEvents(userId: string, uid: string): Promise<void>;
};

function toStatus(value: string | null): PartStat | null {
	return PART_STATS.find((status) => status === value) ?? null;
}

export function createD1InvitationsRepository(db: D1Database): InvitationsRepository {
	const insertEvent = (userId: string, uid: string, event: InviteEventRow) =>
		db
			.prepare(
				`INSERT INTO calendar_events
				 (id, user_id, source, source_id, external_uid, title, starts_at, ends_at, all_day, location, notes, busy)
				 VALUES (?, ?, 'invite', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				event.id,
				userId,
				uid,
				event.externalUid,
				event.title,
				event.start,
				event.end,
				event.allDay ? 1 : 0,
				event.location,
				event.notes,
				event.busy ? 1 : 0
			);

	return {
		async get(userId, uid) {
			const row = await db
				.prepare('SELECT uid, sequence, response FROM calendar_invites WHERE user_id = ? AND uid = ?')
				.bind(userId, uid)
				.first<{ uid: string; sequence: number; response: string | null }>();
			return row ? { uid: row.uid, sequence: row.sequence, response: toStatus(row.response) } : null;
		},

		async save(userId, invite) {
			await db
				.prepare(
					`INSERT INTO calendar_invites (user_id, uid, sequence, response, updated_at)
					 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
					 ON CONFLICT (user_id, uid) DO UPDATE SET
					   sequence = excluded.sequence, response = excluded.response, updated_at = CURRENT_TIMESTAMP`
				)
				.bind(userId, invite.uid, invite.sequence, invite.response)
				.run();
		},

		async hasEvents(userId, uid) {
			const row = await db
				.prepare(
					`SELECT 1 AS found FROM calendar_events
					 WHERE user_id = ? AND source = 'invite' AND source_id = ? LIMIT 1`
				)
				.bind(userId, uid)
				.first<{ found: number }>();
			return row !== null;
		},

		async replaceEvents(userId, uid, events) {
			await db.batch([
				db
					.prepare(`DELETE FROM calendar_events WHERE user_id = ? AND source = 'invite' AND source_id = ?`)
					.bind(userId, uid),
				...events.map((event) => insertEvent(userId, uid, event))
			]);
		},

		async replaceOccurrence(userId, uid, externalUid, event) {
			await db.batch([
				db
					.prepare(
						`DELETE FROM calendar_events
						 WHERE user_id = ? AND source = 'invite' AND source_id = ? AND external_uid = ?`
					)
					.bind(userId, uid, externalUid),
				...(event ? [insertEvent(userId, uid, event)] : [])
			]);
		},

		async removeEvents(userId, uid) {
			await db
				.prepare(`DELETE FROM calendar_events WHERE user_id = ? AND source = 'invite' AND source_id = ?`)
				.bind(userId, uid)
				.run();
		}
	};
}
