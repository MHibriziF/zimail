import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AdmissionsRepository, AdmissionStatus, PendingAdmission } from '../../admissions/repository';
import type { LiveKitClient, RoomParticipant, TrackSourceName } from '../../livekit';
import type { Meeting, MeetingFieldPatch, MeetingsRepository, NewMeeting } from '../repository';
import { createMeetingsService } from '../service';

function meeting(overrides: Partial<Meeting> = {}): Meeting {
	return {
		id: 'meeting-1',
		user_id: 'user-1',
		code: 'aaa-aaaa-aaa',
		title: 'Standup',
		require_approval: false,
		screen_share_policy: 'open',
		screen_share_mode: 'multiple',
		created_at: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

/** In-memory `MeetingsRepository` — the same collision-retry proof the old mockDb gave, without hand-rolled D1. */
function fakeMeetingsRepo(seed: Meeting[] = [], options: { forceCollisions?: number } = {}) {
	const rows = seed.map((m) => ({ ...m }));
	let forcedFailures = options.forceCollisions ?? 0;

	const repo: MeetingsRepository = {
		async countForUser(userId) {
			return rows.filter((m) => m.user_id === userId).length;
		},
		async insert(input: NewMeeting) {
			if (forcedFailures > 0) {
				forcedFailures -= 1;
				throw new Error('UNIQUE constraint failed: meetings.code');
			}
			if (rows.some((m) => m.code === input.code)) {
				throw new Error('UNIQUE constraint failed: meetings.code');
			}
			rows.push({
				id: input.id,
				user_id: input.userId,
				code: input.code,
				title: input.title,
				require_approval: input.requireApproval,
				screen_share_policy: 'open',
				screen_share_mode: 'multiple',
				created_at: input.createdAt
			});
		},
		async listForUser(userId, limit) {
			const mine = rows.filter((m) => m.user_id === userId);
			// Mirrors SQLite: a negative LIMIT means no limit.
			return limit === undefined || limit < 0 ? mine : mine.slice(0, limit);
		},
		async deleteForUser(userId, id) {
			const index = rows.findIndex((m) => m.id === id && m.user_id === userId);
			if (index === -1) return false;
			rows.splice(index, 1);
			return true;
		},
		async findByCode(code) {
			return rows.find((m) => m.code === code) ?? null;
		},
		async getForUser(userId, id) {
			return rows.find((m) => m.id === id && m.user_id === userId) ?? null;
		},
		async updateFields(userId, id, patch: MeetingFieldPatch) {
			const row = rows.find((m) => m.id === id && m.user_id === userId);
			if (!row) return false;
			if (patch.title !== undefined) row.title = patch.title;
			if (patch.requireApproval !== undefined) row.require_approval = patch.requireApproval;
			if (patch.screenSharePolicy !== undefined) row.screen_share_policy = patch.screenSharePolicy;
			if (patch.screenShareMode !== undefined) row.screen_share_mode = patch.screenShareMode;
			return true;
		},
		async updateCode(userId, id, code) {
			if (forcedFailures > 0) {
				forcedFailures -= 1;
				throw new Error('UNIQUE constraint failed: meetings.code');
			}
			if (rows.some((m) => m.code === code && m.id !== id)) {
				throw new Error('UNIQUE constraint failed: meetings.code');
			}
			const row = rows.find((m) => m.id === id && m.user_id === userId);
			if (!row) return false;
			row.code = code;
			return true;
		}
	};

	return { repo, rows };
}

function fakeAdmissionsRepo(): AdmissionsRepository & { seedStatus(id: string, status: AdmissionStatus): void } {
	const rows = new Map<string, { meetingId: string; name: string; status: AdmissionStatus; created_at: string }>();
	let clock = 0;

	return {
		async create(meetingId, name) {
			const id = crypto.randomUUID();
			clock += 1;
			rows.set(id, { meetingId, name: name.trim() || 'Guest', status: 'pending', created_at: `t${clock}` });
			return { id };
		},
		async get(meetingId, admissionId) {
			const row = rows.get(admissionId);
			return row && row.meetingId === meetingId ? { status: row.status } : null;
		},
		async listPending(meetingId): Promise<PendingAdmission[]> {
			return [...rows.entries()]
				.filter(([, row]) => row.meetingId === meetingId && row.status === 'pending')
				.map(([id, row]) => ({ id, name: row.name, created_at: row.created_at }));
		},
		async setStatus(meetingId, admissionId, status) {
			const row = rows.get(admissionId);
			if (!row || row.meetingId !== meetingId) return false;
			row.status = status;
			return true;
		},
		seedStatus(id, status) {
			rows.set(id, { meetingId: 'meeting-1', name: 'Guest', status, created_at: 't0' });
		}
	};
}

function fakeLiveKit(): LiveKitClient {
	return {
		url: 'wss://livekit.test',
		async createAccessToken({ identity }) {
			return `token-for-${identity}`;
		},
		async listParticipants() {
			return [];
		},
		async setPublishSources() {}
	};
}

/** Records every token and permission change, with a fixed set of people already in the room. */
function recordingLiveKit(inRoom: RoomParticipant[] = []) {
	const tokens: Parameters<LiveKitClient['createAccessToken']>[0][] = [];
	const permissionChanges: { room: string; identity: string; sources: TrackSourceName[] }[] = [];
	const client: LiveKitClient = {
		url: 'wss://livekit.test',
		async createAccessToken(options) {
			tokens.push(options);
			return 'token';
		},
		async listParticipants() {
			return inRoom;
		},
		async setPublishSources(room, identity, sources) {
			permissionChanges.push({ room, identity, sources });
		}
	};
	return { client, tokens, permissionChanges };
}

describe('create', () => {
	test('the first meeting is "Meeting #1", the next is "#2", per user', async () => {
		const { repo } = fakeMeetingsRepo();
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });

		const first = await service.create('user-1');
		const second = await service.create('user-1');
		const other = await service.create('user-2');
		assert.equal(first.meeting.title, 'Meeting #1');
		assert.equal(second.meeting.title, 'Meeting #2');
		assert.equal(other.meeting.title, 'Meeting #1');
	});

	test('a given title is used as-is', async () => {
		const { repo } = fakeMeetingsRepo();
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		const created = await service.create('user-1', { title: 'Standup' });
		assert.equal(created.meeting.title, 'Standup');
	});

	test('a code collision is retried rather than failing the create', async () => {
		const { repo, rows } = fakeMeetingsRepo([], { forceCollisions: 1 });
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		const created = await service.create('user-1');
		assert.match(created.code, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
		assert.equal(rows.length, 1);
	});

	test('gives up after exhausting every retry attempt', async () => {
		const { repo } = fakeMeetingsRepo([], { forceCollisions: 5 });
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		await assert.rejects(service.create('user-1'), /unique/i);
	});
});

describe('getForUser', () => {
	test('is ownership-scoped', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal((await service.getForUser('user-1', 'meeting-1'))?.title, 'Standup');
		assert.equal(await service.getForUser('someone-else', 'meeting-1'), null);
	});
});

describe('list', () => {
	test('without a limit returns everything the user owns', async () => {
		const { repo } = fakeMeetingsRepo([meeting(), meeting({ id: 'meeting-2', code: 'bbb-bbbb-bbb' })]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal((await service.list('user-1')).length, 2);
	});

	test('passes the limit through, so a long history loads a page at a time', async () => {
		const { repo } = fakeMeetingsRepo([meeting(), meeting({ id: 'meeting-2', code: 'bbb-bbbb-bbb' })]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal((await service.list('user-1', 1)).length, 1);
	});
});

describe('remove', () => {
	test('deletes the meeting, so its code stops resolving', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal(await service.remove('user-1', 'meeting-1'), true);
		assert.equal(await service.findByCode('aaa-aaaa-aaa'), null);
	});

	test('is ownership-scoped — someone else cannot delete it', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal(await service.remove('someone-else', 'meeting-1'), false);
		assert.equal((await service.getForUser('user-1', 'meeting-1'))?.title, 'Standup');
	});

	test('a meeting that is not there reports false rather than throwing', async () => {
		const { repo } = fakeMeetingsRepo([]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal(await service.remove('user-1', 'missing'), false);
	});
});

describe('update', () => {
	test('an empty patch returns the meeting unchanged', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal((await service.update('user-1', 'meeting-1', {}))?.title, 'Standup');
	});

	test('applies only the given fields, ownership-checked', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });

		const updated = await service.update('user-1', 'meeting-1', { requireApproval: true });
		assert.equal(updated?.title, 'Standup');
		assert.equal(updated?.require_approval, true);

		assert.equal(await service.update('someone-else', 'meeting-1', { title: 'Hijacked' }), null);
	});
});

describe('rotateCode', () => {
	test('cannot rotate a meeting owned by someone else', async () => {
		const { repo, rows } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal(await service.rotateCode('someone-else', 'meeting-1'), null);
		assert.equal(rows[0].code, 'aaa-aaaa-aaa');
	});

	test('a collision on rotate is retried rather than failing', async () => {
		const { repo } = fakeMeetingsRepo([meeting()], { forceCollisions: 1 });
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		const rotated = await service.rotateCode('user-1', 'meeting-1');
		assert.ok(rotated);
		assert.notEqual(rotated, 'aaa-aaaa-aaa');
	});

	test('gives up after exhausting every retry attempt', async () => {
		const { repo } = fakeMeetingsRepo([meeting()], { forceCollisions: 5 });
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		await assert.rejects(service.rotateCode('user-1', 'meeting-1'), /unique/i);
	});
});

describe('listPendingAdmissions', () => {
	test('null when the caller does not own the meeting', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.equal(await service.listPendingAdmissions('someone-else', 'meeting-1'), null);
	});

	test('lists the pending admissions for an owned meeting', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const admissionsRepo = fakeAdmissionsRepo();
		await admissionsRepo.create('meeting-1', 'Ada');
		const service = createMeetingsService({ repo, admissionsRepo, getLiveKit: fakeLiveKit });

		const pending = await service.listPendingAdmissions('user-1', 'meeting-1');
		assert.equal(pending?.length, 1);
		assert.equal(pending?.[0].name, 'Ada');
	});
});

describe('requestJoin', () => {
	test('returns not_found for an unknown code', async () => {
		const service = createMeetingsService({ repo: fakeMeetingsRepo().repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		assert.deepEqual(await service.requestJoin('no-such-code', {}), { type: 'not_found' });
	});

	test('mints a token immediately for an open meeting', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ require_approval: false })]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		const outcome = await service.requestJoin('aaa-aaaa-aaa', { requesterId: 'someone-else' });
		assert.equal(outcome.type, 'admitted');
	});

	test('the owner always gets in immediately, even if approval is required', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ require_approval: true })]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		const outcome = await service.requestJoin('aaa-aaaa-aaa', { requesterId: 'user-1' });
		assert.equal(outcome.type, 'admitted');
	});

	test('a non-owner stages a pending admission when approval is required', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ require_approval: true })]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		const outcome = await service.requestJoin('aaa-aaaa-aaa', { requesterId: 'someone-else', name: 'Ada' });
		assert.equal(outcome.type, 'pending');
	});
});

describe('checkAdmission', () => {
	test('reports meeting_not_found / admission_not_found distinctly', async () => {
		const admissionsRepo = fakeAdmissionsRepo();
		const { repo } = fakeMeetingsRepo([meeting()]);
		const service = createMeetingsService({ repo, admissionsRepo, getLiveKit: fakeLiveKit });

		assert.deepEqual(await service.checkAdmission('no-such-code', 'x', undefined), { type: 'meeting_not_found' });
		assert.deepEqual(await service.checkAdmission('aaa-aaaa-aaa', 'no-such-admission', undefined), {
			type: 'admission_not_found'
		});
	});

	test('mints a token once admitted, otherwise reports the current status', async () => {
		const admissionsRepo = fakeAdmissionsRepo();
		const { repo } = fakeMeetingsRepo([meeting()]);
		const { id } = await admissionsRepo.create('meeting-1', 'Ada');
		const service = createMeetingsService({ repo, admissionsRepo, getLiveKit: fakeLiveKit });

		assert.deepEqual(await service.checkAdmission('aaa-aaaa-aaa', id, undefined), {
			type: 'waiting',
			status: 'pending'
		});

		await admissionsRepo.setStatus('meeting-1', id, 'admitted');
		const outcome = await service.checkAdmission('aaa-aaaa-aaa', id, 'Ada');
		assert.equal(outcome.type, 'admitted');
	});
});

describe('decideAdmission', () => {
	test('meeting_not_found when the caller does not own the meeting', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const admissionsRepo = fakeAdmissionsRepo();
		const service = createMeetingsService({ repo, admissionsRepo, getLiveKit: fakeLiveKit });
		assert.equal(await service.decideAdmission('someone-else', 'meeting-1', 'x', 'admitted'), 'meeting_not_found');
	});

	test('admission_not_found for an unknown admission, ok once applied', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const admissionsRepo = fakeAdmissionsRepo();
		const { id } = await admissionsRepo.create('meeting-1', 'Ada');
		const service = createMeetingsService({ repo, admissionsRepo, getLiveKit: fakeLiveKit });

		assert.equal(await service.decideAdmission('user-1', 'meeting-1', 'no-such-admission', 'denied'), 'admission_not_found');
		assert.equal(await service.decideAdmission('user-1', 'meeting-1', id, 'admitted'), 'ok');
		assert.equal((await admissionsRepo.get('meeting-1', id))?.status, 'admitted');
	});
});

describe('screen-share policy', () => {
	test('under "approval", a guest token cannot publish a screen share but the host token can', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ screen_share_policy: 'approval' })]);
		const liveKit = recordingLiveKit();
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		await service.requestJoin('aaa-aaaa-aaa', { name: 'Guest' });
		await service.requestJoin('aaa-aaaa-aaa', { name: 'Host', requesterId: 'user-1' });

		assert.deepEqual(liveKit.tokens[0].canPublishSources, ['camera', 'microphone']);
		assert.equal(liveKit.tokens[1].canPublishSources, undefined);
	});

	test('under "open", guest tokens are unrestricted', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const liveKit = recordingLiveKit();
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });
		await service.requestJoin('aaa-aaaa-aaa', { name: 'Guest' });
		assert.equal(liveKit.tokens[0].canPublishSources, undefined);
	});

	test('an admitted guest waiting-room token follows the policy too', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ require_approval: true, screen_share_policy: 'approval' })]);
		const admissions = fakeAdmissionsRepo();
		const liveKit = recordingLiveKit();
		const service = createMeetingsService({ repo, admissionsRepo: admissions, getLiveKit: () => liveKit.client });

		admissions.seedStatus('adm-1', 'admitted');
		const outcome = await service.checkAdmission('aaa-aaaa-aaa', 'adm-1', 'Guest');
		assert.equal(outcome.type, 'admitted');
		assert.deepEqual(liveKit.tokens[0].canPublishSources, ['camera', 'microphone']);
	});

	test('joining reports the meeting\'s screen-share settings', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ screen_share_mode: 'single' })]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: fakeLiveKit });
		const outcome = await service.requestJoin('aaa-aaaa-aaa', { name: 'Guest' });
		assert.equal(outcome.type, 'admitted');
		if (outcome.type === 'admitted') assert.deepEqual(outcome.screenShare, { policy: 'open', mode: 'single' });
	});

	test('changing the policy mid-call re-applies it to everyone in the room except the host', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const liveKit = recordingLiveKit([
			{ identity: 'host-1', attributes: {} },
			{ identity: 'guest', attributes: {} }
		]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		await service.update('user-1', 'meeting-1', { screenSharePolicy: 'approval' });
		assert.deepEqual(liveKit.permissionChanges, [
			{ room: 'meeting-1', identity: 'guest', sources: ['camera', 'microphone'] }
		]);

		await service.update('user-1', 'meeting-1', { screenSharePolicy: 'open' });
		assert.deepEqual(liveKit.permissionChanges[1].sources, ['camera', 'microphone', 'screen_share', 'screen_share_audio']);
	});

	test('a guest claiming the host role in its attributes is not exempt from a policy change', async () => {
		// Participants can set their own attributes, so `role: host` proves nothing.
		const { repo } = fakeMeetingsRepo([meeting()]);
		const liveKit = recordingLiveKit([{ identity: 'guest', attributes: { role: 'host' } }]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		await service.update('user-1', 'meeting-1', { screenSharePolicy: 'approval' });
		assert.deepEqual(liveKit.permissionChanges.map((change) => change.identity), ['guest']);
	});

	test('only the owner is minted a host identity', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const liveKit = recordingLiveKit();
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		await service.requestJoin('aaa-aaaa-aaa', { name: 'Host', requesterId: 'user-1' });
		await service.requestJoin('aaa-aaaa-aaa', { name: 'Guest', requesterId: 'someone-else' });
		assert.deepEqual(
			liveKit.tokens.map((token) => token.identity.startsWith('host-')),
			[true, false]
		);
	});

	test('changing only the mode, or re-saving the same policy, touches no one in the room', async () => {
		const { repo } = fakeMeetingsRepo([meeting()]);
		const liveKit = recordingLiveKit([{ identity: 'guest', attributes: {} }]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		await service.update('user-1', 'meeting-1', { screenShareMode: 'single' });
		await service.update('user-1', 'meeting-1', { screenSharePolicy: 'open' });
		assert.deepEqual(liveKit.permissionChanges, []);
	});

	test('someone else cannot change the policy of a meeting they do not own', async () => {
		const { repo, rows } = fakeMeetingsRepo([meeting()]);
		const liveKit = recordingLiveKit([{ identity: 'guest', attributes: {} }]);
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		assert.equal(await service.update('someone-else', 'meeting-1', { screenSharePolicy: 'approval' }), null);
		assert.equal(rows[0].screen_share_policy, 'open');
		assert.deepEqual(liveKit.permissionChanges, []);
	});
});

describe('setScreenShareAllowed', () => {
	test('the owner can allow and then revoke one participant', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ screen_share_policy: 'approval' })]);
		const liveKit = recordingLiveKit();
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		assert.equal(await service.setScreenShareAllowed('user-1', 'meeting-1', 'guest', true), 'ok');
		assert.equal(await service.setScreenShareAllowed('user-1', 'meeting-1', 'guest', false), 'ok');
		assert.deepEqual(
			liveKit.permissionChanges.map((change) => change.sources.includes('screen_share')),
			[true, false]
		);
	});

	test('nobody but the owner can grant it', async () => {
		const { repo } = fakeMeetingsRepo([meeting({ screen_share_policy: 'approval' })]);
		const liveKit = recordingLiveKit();
		const service = createMeetingsService({ repo, admissionsRepo: fakeAdmissionsRepo(), getLiveKit: () => liveKit.client });

		assert.equal(await service.setScreenShareAllowed('someone-else', 'meeting-1', 'guest', true), 'meeting_not_found');
		assert.deepEqual(liveKit.permissionChanges, []);
	});
});
