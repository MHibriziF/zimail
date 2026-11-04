const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `in 12 minutes` / `3 hours ago` / `tomorrow`, in the reader's language, for a gap of `ms` from now. */
export function relativeTime(ms: number, locale: string): string {
	const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	const size = Math.abs(ms);
	if (size < HOUR_MS) return format.format(Math.round(ms / MINUTE_MS), 'minute');
	if (size < DAY_MS) return format.format(Math.round(ms / HOUR_MS), 'hour');
	return format.format(Math.round(ms / DAY_MS), 'day');
}
