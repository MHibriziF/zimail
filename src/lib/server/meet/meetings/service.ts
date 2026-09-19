import type { AdmissionsRepository, AdmissionStatus, PendingAdmission } from '../admissions/repository';
import { createHostIdentity, isHostIdentity } from '../../../meet/host-identity';
import {
	DEFAULT_SCREEN_SHARE,
	type ScreenShareMode,
	type ScreenSharePolicy,
	type ScreenShareSettings
} from '../../../meet/screen-share';
import { ALL_TRACK_SOURCES, NON_SCREEN_TRACK_SOURCES, type LiveKitClient, type TrackSourceName } from '../livekit';
import type { Meeting, MeetingFieldPatch, MeetingsRepository } from './repository';

/** A freshly created meeting: the join code plus its summary. */
export type CreatedMeeting = {
	code: string;
	meeting: Meeting;
};

export type JoinOutcome =
	| { type: 'not_found' }
	| { type: 'pending'; admissionId: string }
	| AdmittedOutcome;

type AdmittedOutcome = {
	type: 'admitted';
	url: string;
	token: string;
	roomName: string;
	screenShare: ScreenShareSettings;
};

export type AdmissionCheckOutcome =
	| { type: 'meeting_not_found' }
	| { type: 'admission_not_found' }
	| { type: 'waiting'; status: Exclude<AdmissionStatus, 'admitted'> }
	| AdmittedOutcome;

export type DecideAdmissionOutcome = 'meeting_not_found' | 'admission_not_found' | 'ok';

export type MeetingChanges = {
	title?: string;
	requireApproval?: boolean;
	screenSharePolicy?: ScreenSharePolicy;
	screenShareMode?: ScreenShareMode;
};

/** What a participant may publish under the meeting's policy — the host is never restricted. */
function publishSourcesFor(meeting: Meeting, isOwner: boolean): TrackSourceName[] | undefined {
	return meeting.screen_share_policy === 'approval' && !isOwner ? NON_SCREEN_TRACK_SOURCES : undefined;
}

function screenShareSettingsOf(meeting: Meeting): ScreenShareSettings {
	return { policy: meeting.screen_share_policy, mode: meeting.screen_share_mode };
}

const CODE_GROUP_LENGTHS = [3, 4, 3];
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const MAX_CODE_ATTEMPTS = 5;

/**
 * A short, typeable join code in Google Meet's shape (`xxx-xxxx-xxx`). This is
 * the entire join credential now, so it's plain text, not something derived
 * from a secret.
 */
export function createMeetingCode(): string {
	return CODE_GROUP_LENGTHS.map(randomLetters).join('-');
}

// 256 isn't a multiple of 26, so naive `byte % 26` is slightly biased toward
// the first 22 letters. Reject bytes above the highest multiple of 26 that
// still fits in a byte, so every letter stays equally likely.
const REJECTION_LIMIT = 256 - (256 % CODE_ALPHABET.length);

function randomLetters(length: number): string {
	let result = '';
	while (result.length < length) {
		const [byte] = crypto.getRandomValues(new Uint8Array(1));
		if (byte >= REJECTION_LIMIT) continue;
		result += CODE_ALPHABET[byte % CODE_ALPHABET.length];
	}
	return result;
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique constraint/i.test(error.message);
}

export type MeetingsService = {
	create(
		userId: string,
		options?: { title?: string; domainId?: string | null; requireApproval?: boolean }
	): Promise<CreatedMeeting>;
	list(userId: string): Promise<Meeting[]>;
	findByCode(code: string): Promise<Meeting | null>;
	getForUser(userId: string, id: string): Promise<Meeting | null>;
	update(userId: string, id: string, changes: MeetingChanges): Promise<Meeting | null>;
	/**
	 * Owner-only: let one participant share their screen (or take it back) in the
	 * live call. `meeting_not_found` when it doesn't exist or isn't the caller's.
	 */
	setScreenShareAllowed(
		userId: string,
		meetingId: string,
		identity: string,
		allowed: boolean
	): Promise<'meeting_not_found' | 'ok'>;
	rotateCode(userId: string, id: string): Promise<string | null>;
	/** Owner-only — `null` when the meeting doesn't exist or isn't the caller's. */
	listPendingAdmissions(userId: string, meetingId: string): Promise<PendingAdmission[] | null>;

	requestJoin(code: string, input: { name?: string; requesterId?: string }): Promise<JoinOutcome>;
	checkAdmission(
		code: string,
		admissionId: string,
		name: string | undefined
	): Promise<AdmissionCheckOutcome>;
	decideAdmission(
		userId: string,
		meetingId: string,
		admissionId: string,
		status: Exclude<AdmissionStatus, 'pending'>
	): Promise<DecideAdmissionOutcome>;
};

export type MeetingsServiceDeps = {
	repo: MeetingsRepository;
	admissionsRepo: AdmissionsRepository;
	/** Lazy so building the service never requires LiveKit to be configured — only join/admission-check calls it. */
	getLiveKit: () => LiveKitClient;
};

function admitted(liveKit: LiveKitClient, token: string, meeting: Meeting): AdmittedOutcome {
	return { type: 'admitted', url: liveKit.url, token, roomName: meeting.id, screenShare: screenShareSettingsOf(meeting) };
}

export function createMeetingsService(deps: MeetingsServiceDeps): MeetingsService {
	const { repo, admissionsRepo, getLiveKit } = deps;

	/**
	 * Tokens only carry the policy that was in force when they were minted, so a
	 * change mid-call has to be pushed to everyone already in the room. Switching
	 * to `approval` takes back any permission the host granted under the old one.
	 */
	async function applyScreenSharePolicyToRoom(meeting: Meeting) {
		const liveKit = getLiveKit();
		const sources = meeting.screen_share_policy === 'approval' ? NON_SCREEN_TRACK_SOURCES : ALL_TRACK_SOURCES;
		const participants = await liveKit.listParticipants(meeting.id);
		await Promise.all(
			participants
				.filter((participant) => !isHostIdentity(participant.identity))
				.map((participant) => liveKit.setPublishSources(meeting.id, participant.identity, sources))
		);
	}

	/** `Meeting #N` for the caller's Nth meeting, used whenever no title is given at creation. */
	async function defaultTitle(userId: string): Promise<string> {
		return `Meeting #${(await repo.countForUser(userId)) + 1}`;
	}

	return {
		async create(userId, options = {}) {
			const id = crypto.randomUUID();
			const title = options.title?.trim().slice(0, 200) || (await defaultTitle(userId));
			const requireApproval = options.requireApproval ?? false;
			const createdAt = new Date().toISOString();

			for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
				const code = createMeetingCode();
				try {
					await repo.insert({
						id,
						userId,
						domainId: options.domainId ?? null,
						title,
						code,
						requireApproval,
						createdAt
					});

					return {
						code,
						meeting: {
							id,
							user_id: userId,
							code,
							title,
							require_approval: requireApproval,
							screen_share_policy: DEFAULT_SCREEN_SHARE.policy,
							screen_share_mode: DEFAULT_SCREEN_SHARE.mode,
							created_at: createdAt
						}
					};
				} catch (error) {
					if (!isUniqueConstraintError(error) || attempt === MAX_CODE_ATTEMPTS - 1) throw error;
				}
			}

			throw new Error('Could not generate a unique meeting code');
		},

		list: (userId) => repo.listForUser(userId),
		findByCode: (code) => repo.findByCode(code),
		getForUser: (userId, id) => repo.getForUser(userId, id),

		async update(userId, id, changes) {
			const patch: MeetingFieldPatch = {};
			if (changes.title !== undefined) patch.title = changes.title.trim().slice(0, 200) || null;
			if (changes.requireApproval !== undefined) patch.requireApproval = changes.requireApproval;
			if (changes.screenSharePolicy !== undefined) patch.screenSharePolicy = changes.screenSharePolicy;
			if (changes.screenShareMode !== undefined) patch.screenShareMode = changes.screenShareMode;

			if (Object.keys(patch).length === 0) return repo.getForUser(userId, id);

			const previousPolicy = (await repo.getForUser(userId, id))?.screen_share_policy;
			if (!previousPolicy) return null;
			const changed = await repo.updateFields(userId, id, patch);
			if (!changed) return null;
			const after = await repo.getForUser(userId, id);

			if (after && after.screen_share_policy !== previousPolicy) {
				await applyScreenSharePolicyToRoom(after);
			}
			return after;
		},

		async setScreenShareAllowed(userId, meetingId, identity, allowed) {
			const meeting = await repo.getForUser(userId, meetingId);
			if (!meeting) return 'meeting_not_found';
			await getLiveKit().setPublishSources(meeting.id, identity, allowed ? ALL_TRACK_SOURCES : NON_SCREEN_TRACK_SOURCES);
			return 'ok';
		},

		/**
		 * Mints a fresh code for a meeting, e.g. after the old one was shared too
		 * widely. The room itself (see livekit.ts, keyed by the stable internal id)
		 * is untouched, so this doesn't disrupt anyone already on a call.
		 */
		async rotateCode(userId, id) {
			for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
				const code = createMeetingCode();
				try {
					const changed = await repo.updateCode(userId, id, code);
					return changed ? code : null;
				} catch (error) {
					if (!isUniqueConstraintError(error) || attempt === MAX_CODE_ATTEMPTS - 1) throw error;
				}
			}

			throw new Error('Could not generate a unique meeting code');
		},

		async listPendingAdmissions(userId, meetingId) {
			const meeting = await repo.getForUser(userId, meetingId);
			if (!meeting) return null;
			return admissionsRepo.listPending(meetingId);
		},

		/**
		 * Join a meeting. The code is the only credential, same as a Google
		 * Meet/Zoom meeting code. If the meeting requires approval and the
		 * requester isn't its owner, this stages a pending admission instead of
		 * minting a token.
		 */
		async requestJoin(code, { name, requesterId }) {
			const meeting = await repo.findByCode(code);
			if (!meeting) return { type: 'not_found' };

			const isOwner = requesterId === meeting.user_id;
			if (meeting.require_approval && !isOwner) {
				const admission = await admissionsRepo.create(meeting.id, name ?? 'Guest');
				return { type: 'pending', admissionId: admission.id };
			}

			const liveKit = getLiveKit();
			const token = await liveKit.createAccessToken({
				identity: isOwner ? createHostIdentity() : crypto.randomUUID(),
				name,
				room: meeting.id,
				canPublishSources: publishSourcesFor(meeting, isOwner)
			});

			return admitted(liveKit, token, meeting);
		},

		/** Polled by a guest waiting to be let in — the second half of `requestJoin`. */
		async checkAdmission(code, admissionId, name) {
			const meeting = await repo.findByCode(code);
			if (!meeting) return { type: 'meeting_not_found' };

			const admission = await admissionsRepo.get(meeting.id, admissionId);
			if (!admission) return { type: 'admission_not_found' };

			if (admission.status !== 'admitted') {
				return { type: 'waiting', status: admission.status };
			}

			const liveKit = getLiveKit();
			const token = await liveKit.createAccessToken({
				identity: crypto.randomUUID(),
				name,
				room: meeting.id,
				canPublishSources: publishSourcesFor(meeting, false)
			});

			return admitted(liveKit, token, meeting);
		},

		/** Admit or deny one pending join request — owner-only. */
		async decideAdmission(userId, meetingId, admissionId, status) {
			const meeting = await repo.getForUser(userId, meetingId);
			if (!meeting) return 'meeting_not_found';

			const updated = await admissionsRepo.setStatus(meetingId, admissionId, status);
			return updated ? 'ok' : 'admission_not_found';
		}
	};
}
