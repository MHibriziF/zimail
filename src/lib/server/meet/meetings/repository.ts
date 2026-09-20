import type { D1Database } from '@cloudflare/workers-types';
import {
	DEFAULT_SCREEN_SHARE,
	parseScreenShareMode,
	parseScreenSharePolicy,
	type ScreenShareMode,
	type ScreenSharePolicy
} from '../../../meet/screen-share';

export type Meeting = {
	id: string;
	user_id: string;
	code: string | null;
	title: string | null;
	require_approval: boolean;
	screen_share_policy: ScreenSharePolicy;
	screen_share_mode: ScreenShareMode;
	created_at: string;
};

type MeetingRow = Omit<Meeting, 'require_approval' | 'screen_share_policy' | 'screen_share_mode'> & {
	require_approval: number;
	screen_share_policy: string;
	screen_share_mode: string;
};

function toMeeting(row: MeetingRow): Meeting {
	return {
		...row,
		require_approval: !!row.require_approval,
		screen_share_policy: parseScreenSharePolicy(row.screen_share_policy) ?? DEFAULT_SCREEN_SHARE.policy,
		screen_share_mode: parseScreenShareMode(row.screen_share_mode) ?? DEFAULT_SCREEN_SHARE.mode
	};
}

export type NewMeeting = {
	id: string;
	userId: string;
	domainId: string | null;
	title: string;
	code: string;
	requireApproval: boolean;
	createdAt: string;
};

export type MeetingFieldPatch = {
	title?: string | null;
	requireApproval?: boolean;
	screenSharePolicy?: ScreenSharePolicy;
	screenShareMode?: ScreenShareMode;
};

/**
 * Raw D1 access for meetings — no retry-on-collision, no default-title
 * generation, no title normalization. See `../meetings/service.ts` for those
 * rules; `insert`/`updateCode` let a unique-constraint violation on `code`
 * propagate exactly as D1 throws it, for the service's retry loop to catch.
 */
export type MeetingsRepository = {
	countForUser(userId: string): Promise<number>;
	insert(meeting: NewMeeting): Promise<void>;
	/** Newest first. `limit` bounds the query so a long history can't load the whole table. */
	listForUser(userId: string, limit?: number): Promise<Meeting[]>;
	deleteForUser(userId: string, id: string): Promise<boolean>;
	findByCode(code: string): Promise<Meeting | null>;
	getForUser(userId: string, id: string): Promise<Meeting | null>;
	updateFields(userId: string, id: string, patch: MeetingFieldPatch): Promise<boolean>;
	updateCode(userId: string, id: string, code: string): Promise<boolean>;
};

const SELECT_FIELDS =
	'id, user_id, code, title, require_approval, screen_share_policy, screen_share_mode, created_at';

export function createD1MeetingsRepository(db: D1Database): MeetingsRepository {
	return {
		async countForUser(userId) {
			const row = await db
				.prepare('SELECT COUNT(*) AS count FROM meetings WHERE user_id = ?')
				.bind(userId)
				.first<{ count: number }>();
			return row?.count ?? 0;
		},

		async insert(meeting) {
			await db
				.prepare(
					`INSERT INTO meetings (id, user_id, domain_id, title, code, require_approval, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					meeting.id,
					meeting.userId,
					meeting.domainId,
					meeting.title,
					meeting.code,
					meeting.requireApproval ? 1 : 0,
					meeting.createdAt
				)
				.run();
		},

		async listForUser(userId, limit) {
			// -1 is SQLite's "no limit", so one statement covers both cases.
			const { results } = await db
				.prepare(`SELECT ${SELECT_FIELDS} FROM meetings WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
				.bind(userId, limit ?? -1)
				.all<MeetingRow>();
			return results.map(toMeeting);
		},

		async deleteForUser(userId, id) {
			// meeting_admissions cascades (migration 0029), so the code stops working too.
			const result = await db
				.prepare('DELETE FROM meetings WHERE id = ? AND user_id = ?')
				.bind(id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		},

		async findByCode(code) {
			const row = await db
				.prepare(`SELECT ${SELECT_FIELDS} FROM meetings WHERE code = ?`)
				.bind(code)
				.first<MeetingRow>();
			return row ? toMeeting(row) : null;
		},

		async getForUser(userId, id) {
			const row = await db
				.prepare(`SELECT ${SELECT_FIELDS} FROM meetings WHERE id = ? AND user_id = ?`)
				.bind(id, userId)
				.first<MeetingRow>();
			return row ? toMeeting(row) : null;
		},

		async updateFields(userId, id, patch) {
			const sets: string[] = [];
			const values: unknown[] = [];

			if (patch.title !== undefined) {
				sets.push('title = ?');
				values.push(patch.title);
			}
			if (patch.requireApproval !== undefined) {
				sets.push('require_approval = ?');
				values.push(patch.requireApproval ? 1 : 0);
			}
			if (patch.screenSharePolicy !== undefined) {
				sets.push('screen_share_policy = ?');
				values.push(patch.screenSharePolicy);
			}
			if (patch.screenShareMode !== undefined) {
				sets.push('screen_share_mode = ?');
				values.push(patch.screenShareMode);
			}
			if (sets.length === 0) return false;

			const result = await db
				.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
				.bind(...values, id, userId)
				.run();

			return (result.meta.changes ?? 0) > 0;
		},

		async updateCode(userId, id, code) {
			const result = await db
				.prepare('UPDATE meetings SET code = ? WHERE id = ? AND user_id = ?')
				.bind(code, id, userId)
				.run();
			return (result.meta.changes ?? 0) > 0;
		}
	};
}
