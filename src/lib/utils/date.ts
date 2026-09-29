import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
import { translate } from '$lib/i18n/translate';

/** `YYYY-MM-DD HH:MM[:SS[.fff]]` — what SQLite's `datetime('now')` and `CURRENT_TIMESTAMP` store. */
const SQLITE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

/**
 * A stored timestamp as an instant. SQLite writes UTC but says nothing of it,
 * and `Date` reads a zone-less date-time as *local* — which put every message
 * hours off by the reader's own UTC offset. ISO strings with a `Z` or an
 * offset are taken as they are.
 */
export function parseTimestamp(value: string): Date {
	return new Date(SQLITE_TIMESTAMP.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

function validDate(value: string): Date | null {
	const date = parseTimestamp(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The calendar day an instant falls on in `timeZone` — the reader's saved zone,
 * or the device's when they follow it (`undefined`).
 */
function dayKey(date: Date, timeZone: string | undefined): string {
	return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(date);
}

/** Whole months from `earlier` to `later`, counted in `timeZone`. */
function monthsBetween(earlier: Date, later: Date, timeZone: string | undefined): number {
	const [fromYear, fromMonth] = dayKey(earlier, timeZone).split('-').map(Number);
	const [toYear, toMonth] = dayKey(later, timeZone).split('-').map(Number);
	return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

export function formatRelativeDate(value: string, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
	const date = validDate(value);
	if (!date) return '';
	const now = new Date();
	const tag = intlLocale(locale);
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60_000);
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffMins < 1) return translate(locale, 'date.now');
	if (diffMins < 60) return `${diffMins}m`;
	if (dayKey(date, timeZone) === dayKey(now, timeZone)) {
		return date.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit', timeZone });
	}
	if (diffDays < 7) {
		return date.toLocaleDateString(tag, { weekday: 'short', timeZone });
	}
	return date.toLocaleDateString(tag, { month: 'short', day: 'numeric', timeZone });
}

export function formatFullDate(value: string, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
	const date = validDate(value);
	if (!date) return '';
	return date.toLocaleString(intlLocale(locale), {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone
	});
}

/** Zero mail timestamps: time for recent mail, `MMM dd` this month, else a short date. */
export function formatMailDate(value: string, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
	const date = validDate(value);
	if (!date) return '';
	const now = new Date();
	const hoursDifference = (now.getTime() - date.getTime()) / 3_600_000;
	if (dayKey(date, timeZone) === dayKey(now, timeZone) || hoursDifference <= 12) {
		return formatMailTime(value, locale, timeZone);
	}
	const monthsApart = monthsBetween(date, now, timeZone);
	if (monthsApart === 0 || monthsApart === 1) {
		return date.toLocaleDateString(intlLocale(locale), { month: 'short', day: '2-digit', timeZone });
	}
	return date.toLocaleDateString(intlLocale(locale), {
		month: '2-digit',
		day: '2-digit',
		year: '2-digit',
		timeZone
	});
}

export function formatMailTime(value: string, locale: string = DEFAULT_LOCALE, timeZone?: string): string {
	const date = validDate(value);
	if (!date) return '';
	return date.toLocaleTimeString(intlLocale(locale), { hour: 'numeric', minute: '2-digit', timeZone });
}

/** Stack a second time line when the primary stamp is a calendar date. */
export function shouldShowSeparateTime(value: string, timeZone?: string): boolean {
	const date = validDate(value);
	if (!date) return false;
	const now = new Date();
	if (dayKey(date, timeZone) === dayKey(now, timeZone)) return false;
	const hoursDifference = (now.getTime() - date.getTime()) / 3_600_000;
	return hoursDifference > 12;
}
