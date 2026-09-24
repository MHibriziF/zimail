/**
 * Wall-clock arithmetic in a named zone.
 *
 * `Date` only knows the host's zone, so "8am next Monday in Asia/Jakarta" cannot
 * be built with `setHours` unless the browser happens to be there. These helpers
 * go through `Intl`, which does know every zone — and knows about DST, which a
 * fixed offset would get wrong twice a year.
 */

/** The zone this browser believes it is in. */
export function detectTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

export function isValidTimeZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

export type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** The wall-clock reading a zone shows at a given instant. */
export function wallIn(instant: Date, timeZone: string): Wall {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(instant);

	const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');

	return {
		year: read('year'),
		month: read('month'),
		day: read('day'),
		// Some locales render midnight as 24.
		hour: read('hour') % 24,
		minute: read('minute'),
		second: read('second')
	};
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
	const wall = wallIn(instant, timeZone);
	const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
	return asUtc - instant.getTime();
}

/**
 * The instant at which a zone reads the given wall time.
 *
 * Solved twice: the offset depends on the instant, and the instant depends on
 * the offset. One correction settles it except across a DST boundary, where the
 * second pass lands on the right side.
 */
export function instantFromWall(
	wall: { year: number; month: number; day: number; hour?: number; minute?: number },
	timeZone: string
): Date {
	const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour ?? 0, wall.minute ?? 0, 0);
	let instant = new Date(target - offsetAt(new Date(target), timeZone));
	instant = new Date(target - offsetAt(instant, timeZone));
	return instant;
}

/** Today's date as that zone sees it. */
export function todayIn(timeZone: string, now = new Date()): Wall {
	return wallIn(now, timeZone);
}

/** `hour:00` on a day `dayOffset` from today, in the given zone. */
export function zonedHour(timeZone: string, dayOffset: number, hour: number, now = new Date()): Date {
	const today = todayIn(timeZone, now);
	// Date.UTC normalises overflow, so day 32 becomes the 1st of next month.
	const shifted = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
	const wall = wallIn(shifted, 'UTC');
	return instantFromWall({ year: wall.year, month: wall.month, day: wall.day, hour }, timeZone);
}

/** Weekday index (0 = Sunday) as the zone sees it. */
export function zonedWeekday(timeZone: string, now = new Date()): number {
	const wall = todayIn(timeZone, now);
	return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

/** `datetime-local` value for an instant, expressed in the given zone. */
export function toLocalInputValue(instant: Date, timeZone: string): string {
	const wall = wallIn(instant, timeZone);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** Reads a `datetime-local` value as wall time in the given zone. */
export function fromLocalInputValue(value: string, timeZone: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
	if (!match) return null;

	return instantFromWall(
		{
			year: Number(match[1]),
			month: Number(match[2]),
			day: Number(match[3]),
			hour: Number(match[4]),
			minute: Number(match[5])
		},
		timeZone
	);
}
