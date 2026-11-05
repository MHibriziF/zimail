/**
 * When a booking's guest gets a reminder email. Pure: the cron sweep and the
 * booking paths both store the result as the booking's `next_reminder_at`.
 */
export const REMINDER_SETTINGS = ['none', 'hour', 'day', 'both'] as const;
export type ReminderSetting = (typeof REMINDER_SETTINGS)[number];
export const DEFAULT_REMINDERS: ReminderSetting = 'day';

export type ReminderKind = 'day' | 'hour';

const HOUR_MS = 3_600_000;
const LEAD_MS: Record<ReminderKind, number> = { day: 24 * HOUR_MS, hour: HOUR_MS };

export function parseReminderSetting(value: unknown): ReminderSetting | undefined {
	return REMINDER_SETTINGS.find((setting) => setting === value);
}

function kindsFor(setting: ReminderSetting): ReminderKind[] {
	if (setting === 'both') return ['day', 'hour'];
	return setting === 'none' ? [] : [setting];
}

/** The earliest reminder for `start` due after `notBefore`, or `null` when none is left. */
export function nextReminderAt(start: Date, setting: ReminderSetting, notBefore: Date): Date | null {
	const due = kindsFor(setting)
		.map((kind) => start.getTime() - LEAD_MS[kind])
		.filter((at) => at > notBefore.getTime() && at < start.getTime())
		.sort((a, b) => a - b);
	return due.length > 0 ? new Date(due[0]) : null;
}

/**
 * A new or moved booking's first reminder. One is only worth sending if at
 * least as long has passed since the confirmation as it is ahead of the start:
 * a day-before reminder for bookings made two or more days ahead, an hour-before
 * one for bookings made two or more hours ahead. Anything sooner would land on
 * top of a confirmation the guest still remembers.
 */
export function firstReminderAt(start: Date, setting: ReminderSetting, bookedAt: Date): Date | null {
	const ahead = start.getTime() - bookedAt.getTime();
	const due = kindsFor(setting)
		.filter((kind) => ahead >= 2 * LEAD_MS[kind])
		.map((kind) => start.getTime() - LEAD_MS[kind])
		.sort((a, b) => a - b);
	return due.length > 0 ? new Date(due[0]) : null;
}

/** Which reminder a due time stands for. Anything well over an hour ahead is the day-before one. */
export function reminderKind(start: Date, dueAt: Date): ReminderKind {
	return start.getTime() - dueAt.getTime() > 2 * HOUR_MS ? 'day' : 'hour';
}
