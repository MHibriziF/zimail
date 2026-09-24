import { createD1CalendarRepository } from './repository';
import { createCalendarService, type CalendarService } from './service';

export type { CalendarRepository, NewCalendarEvent } from './repository';
export { createD1CalendarRepository } from './repository';
export { createCalendarService, type CalendarService, type CalendarWriteOutcome } from './service';

type PlatformLike = App.Platform | undefined | null;

/** Composition root for routes — mirrors `getLabelsService`. */
export function getCalendarService(platform: PlatformLike): CalendarService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return createCalendarService({ repo: createD1CalendarRepository(db) });
}
