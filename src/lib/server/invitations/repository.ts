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
	/** One of the user's own events that guests were invited to: a booking or a manual event. */
	findOwnEvent(userId: string, eventId: string): Promise<OwnEvent | null>;
	/** Records a guest's answer. Only someone already on the guest list is updated. */
	setGuestStatus(userId: string, eventId: string, email: string, status: PartStat): Promise<boolean>;
};

/** An event the user organized, as the answers to its invitation need it. */
export type OwnEvent = {
	id: string;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	source: 'reservation' | 'manual';
	sequence: number;
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
		},

		async findOwnEvent(userId, eventId) {
			const row = await db
				.prepare(
					`SELECT id, title, starts_at, ends_at, all_day, source, sequence FROM calendar_events
					 WHERE id = ? AND user_id = ? AND source IN ('reservation', 'manual')`
				)
				.bind(eventId, userId)
				.first<{
					id: string;
					title: string;
					starts_at: string;
					ends_at: string;
					all_day: number;
					source: 'reservation' | 'manual';
					sequence: number;
				}>();
			return row
				? {
						id: row.id,
						title: row.title,
						start: row.starts_at,
						end: row.ends_at,
						allDay: row.all_day === 1,
						source: row.source,
						sequence: row.sequence
					}
				: null;
		},

		async setGuestStatus(userId, eventId, email, status) {
			const result = await db
				.prepare(
					`UPDATE event_guests SET status = ?, updated_at = CURRENT_TIMESTAMP
					 WHERE event_id = ? AND user_id = ? AND email = ?`
				)
				.bind(status, eventId, userId, email.toLowerCase())
				.run();
			return (result.meta.changes ?? 0) > 0;
		}
	};
}
