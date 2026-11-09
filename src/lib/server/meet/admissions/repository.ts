import type { D1Database } from '@cloudflare/workers-types';
import { admissionStatusesBefore, type AdmissionStatus } from './status';

export type { AdmissionStatus };

export type PendingAdmission = {
	id: string;
	name: string;
	created_at: string;
};

/**
 * A guest's request to join a meeting that requires the host to let people in. Ownership of the
 * parent meeting is checked by the caller (the meetings service), not here — these rows aren't
 * owner-scoped themselves, the meeting they belong to is.
 */
export type AdmissionsRepository = {
	create(meetingId: string, name: string): Promise<{ id: string }>;
	get(meetingId: string, admissionId: string): Promise<{ status: AdmissionStatus } | null>;
	listPending(meetingId: string): Promise<PendingAdmission[]>;
	/** Only legal moves (see `./status`); false when the row is missing or can't make this one. */
	setStatus(
		meetingId: string,
		admissionId: string,
		status: Exclude<AdmissionStatus, 'pending'>
	): Promise<boolean>;
};

export function createD1AdmissionsRepository(db: D1Database): AdmissionsRepository {
	return {
		async create(meetingId, name) {
			const id = crypto.randomUUID();
			await db
				.prepare('INSERT INTO meeting_admissions (id, meeting_id, name) VALUES (?, ?, ?)')
				.bind(id, meetingId, name.trim().slice(0, 100) || 'Guest')
				.run();

			return { id };
		},

		async get(meetingId, admissionId) {
			const row = await db
				.prepare('SELECT status FROM meeting_admissions WHERE id = ? AND meeting_id = ?')
				.bind(admissionId, meetingId)
				.first<{ status: AdmissionStatus }>();

			return row ?? null;
		},

		async listPending(meetingId) {
			const { results } = await db
				.prepare(
					`SELECT id, name, created_at FROM meeting_admissions
					 WHERE meeting_id = ? AND status = 'pending'
					 ORDER BY created_at ASC`
				)
				.bind(meetingId)
				.all<PendingAdmission>();

			return results;
		},

		async setStatus(meetingId, admissionId, status) {
			const from = admissionStatusesBefore(status);
			const result = await db
				.prepare(
					`UPDATE meeting_admissions SET status = ?
					 WHERE id = ? AND meeting_id = ? AND status IN (${from.map(() => '?').join(', ')})`
				)
				.bind(status, admissionId, meetingId, ...from)
				.run();

			return (result.meta.changes ?? 0) > 0;
		}
	};
}
