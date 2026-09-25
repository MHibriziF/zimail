/**
 * Reservation page rules shared by the server (which enforces them) and the
 * owner's form and the public booking page (which check them first).
 */
import { isValidTimeZone } from '../timezone';
import { dateKeyToUtc, isPlausibleEmail } from './events';

export const SLOT_LENGTHS = [15, 20, 30, 45, 60, 90, 120] as const;
export const MAX_WINDOW_DAYS = 180;
export const MAX_BUFFER_MINUTES = 120;
export const MAX_NOTICE_MINUTES = 14 * 24 * 60;
export const MAX_PAGE_TITLE_LENGTH = 100;
export const MAX_PAGE_DESCRIPTION_LENGTH = 1000;
export const MAX_GUEST_NAME_LENGTH = 100;
export const MAX_GUEST_NOTE_LENGTH = 1000;
export const MAX_PAGES_PER_USER = 20;
/** How many days of slots one public request returns. */
export const SLOT_DAYS_PER_REQUEST = 7;

const DAY_MS = 86_400_000;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export type ReservationPageSettings = {
	title: string;
	description: string | null;
	slug: string;
	timeZone: string;
	startDate: string;
	endDate: string;
	/** 0 = Sunday. */
	weekdays: number[];
	/** Minutes after midnight, in `timeZone`. */
	dayStart: number;
	dayEnd: number;
	slotMinutes: number;
	bufferMinutes: number;
	noticeMinutes: number;
	active: boolean;
	/** Give every booking its own Zimail meeting room. */
	withMeeting: boolean;
};

export type ReservationPage = ReservationPageSettings & { id: string };

/** What a guest sees: nothing about the owner's other events. */
export type PublicReservationPage = Pick<
	ReservationPageSettings,
	'title' | 'description' | 'timeZone' | 'startDate' | 'endDate' | 'slotMinutes' | 'withMeeting'
> & { slug: string; host: string };

export type ReservationPageError =
	| 'invalid_title'
	| 'invalid_slug'
	| 'invalid_time_zone'
	| 'invalid_dates'
	| 'invalid_hours'
	| 'invalid_weekdays';

export type GuestInput = { name: string; email: string; note: string };
export type GuestError = 'invalid_name' | 'invalid_email';

function clean(value: unknown, max: number): string {
	return typeof value === 'string' ? value.trim().replaceAll(/\s+/g, ' ').slice(0, max).trim() : '';
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const isInt = (value: unknown, min: number, max: number): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** `My Consulting Hour!` → `my-consulting-hour`. May be too short; the caller adds a suffix. */
export function slugify(title: string): string {
	const words = title
		.normalize('NFKD')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	let slug = '';
	for (const word of words) {
		const next = slug ? `${slug}-${word}` : word;
		if (next.length > 32) break;
		slug = next;
	}
	return slug;
}

export function isValidSlug(slug: string): boolean {
	return SLUG.test(slug) && !slug.includes('--');
}

function checkWindow(input: Record<string, unknown>): ReservationPageError | null {
	const start = dateKeyToUtc(text(input.startDate));
	const end = dateKeyToUtc(text(input.endDate));
	if (!start || !end || end < start || end.getTime() - start.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
		return 'invalid_dates';
	}
	const slot = input.slotMinutes;
	const hoursOk =
		(SLOT_LENGTHS as readonly unknown[]).includes(slot) &&
		isInt(input.dayStart, 0, 1440) &&
		isInt(input.dayEnd, 0, 1440) &&
		(input.dayEnd as number) - (input.dayStart as number) >= (slot as number) &&
		isInt(input.bufferMinutes, 0, MAX_BUFFER_MINUTES) &&
		isInt(input.noticeMinutes, 0, MAX_NOTICE_MINUTES);
	return hoursOk ? null : 'invalid_hours';
}

/** Validates an untrusted body. `slug` may be blank; the server then derives one. */
export function validatePageSettings(
	input: Record<string, unknown>
): { ok: true; value: ReservationPageSettings } | { ok: false; error: ReservationPageError } {
	const title = clean(input.title, MAX_PAGE_TITLE_LENGTH);
	if (!title) return { ok: false, error: 'invalid_title' };
	const slug = clean(input.slug, 40).toLowerCase();
	if (slug && !isValidSlug(slug)) return { ok: false, error: 'invalid_slug' };
	const timeZone = typeof input.timeZone === 'string' ? input.timeZone : '';
	if (!isValidTimeZone(timeZone)) return { ok: false, error: 'invalid_time_zone' };

	const windowError = checkWindow(input);
	if (windowError) return { ok: false, error: windowError };

	const weekdays = Array.isArray(input.weekdays)
		? [...new Set(input.weekdays.filter((day): day is number => isInt(day, 0, 6)))].sort((a, b) => a - b)
		: [];
	if (weekdays.length === 0) return { ok: false, error: 'invalid_weekdays' };

	const description =
		typeof input.description === 'string'
			? input.description.trim().slice(0, MAX_PAGE_DESCRIPTION_LENGTH).trim() || null
			: null;
	return {
		ok: true,
		value: {
			title,
			description,
			slug,
			timeZone,
			startDate: text(input.startDate),
			endDate: text(input.endDate),
			weekdays,
			dayStart: input.dayStart as number,
			dayEnd: input.dayEnd as number,
			slotMinutes: input.slotMinutes as number,
			bufferMinutes: input.bufferMinutes as number,
			noticeMinutes: input.noticeMinutes as number,
			active: input.active !== false,
			withMeeting: input.withMeeting === true
		}
	};
}

export function validateGuest(
	input: Record<string, unknown>
): { ok: true; value: GuestInput } | { ok: false; error: GuestError } {
	const name = clean(input.name, MAX_GUEST_NAME_LENGTH);
	if (!name) return { ok: false, error: 'invalid_name' };
	const email = typeof input.email === 'string' ? input.email.trim() : '';
	if (!isPlausibleEmail(email)) return { ok: false, error: 'invalid_email' };
	const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_GUEST_NOTE_LENGTH) : '';
	return { ok: true, value: { name, email, note } };
}

/** `540` → `09:00`. */
export function minutesToTime(minutes: number): string {
	const clamped = Math.max(0, Math.min(1440, minutes));
	return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** `09:30` → `570`; `null` if unreadable. `24:00` is allowed as the end of the day. */
export function timeToMinutes(value: string): number | null {
	const [hours, minutes] = value.split(':').map(Number);
	if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
	const total = hours * 60 + minutes;
	return total >= 0 && total <= 1440 ? total : null;
}
