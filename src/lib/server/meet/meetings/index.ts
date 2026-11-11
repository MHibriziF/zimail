import { getLiveKitClient } from '../../context';
import { createD1AdmissionsRepository } from '../admissions';
import { createD1MeetingsRepository } from './repository';
import { createMeetingsService, type MeetingsService } from './service';

export type { Meeting, MeetingsRepository } from './repository';
export {
	createMeetingsService,
	createMeetingCode,
	type MeetingsService,
	type CreatedMeeting,
	type JoinOutcome,
	type AdmissionCheckOutcome,
	type DecideAdmissionOutcome
} from './service';

type PlatformLike = App.Platform | undefined | null;

/** Composition root for routes — mirrors `getDomainsService` in `../../domains`. */
export function getMeetingsService(platform: PlatformLike): MeetingsService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return createMeetingsService({
		repo: createD1MeetingsRepository(db),
		admissionsRepo: createD1AdmissionsRepository(db),
		getLiveKit: () => getLiveKitClient(platform)
	});
}
