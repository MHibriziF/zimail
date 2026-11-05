/**
 * Reservation page rules shared by the server (which enforces them) and the
 * owner's form and the public booking page (which check them first).
 */
import { isValidTimeZone } from '../timezone';
import { parseRoomSettings, type RoomSettings } from '../meet/room-settings';
import { dateKeyToUtc, isPlausibleEmail } from './events';
import { DEFAULT_REMINDERS, parseReminderSetting, type ReminderSetting } from './reminders';

export const SLOT_LENGTHS = [15, 20, 30, 45, 60, 90, 120] as const;
export const MAX_WINDOW_DAYS = 180;
export const MAX_BUFFER_MINUTES = 120;
export const MAX_NOTICE_MINUTES = 14 * 24 * 60;
export const MAX_PAGE_TITLE_LENGTH = 100;
export const MAX_PAGE_DESCRIPTION_LENGTH = 1000;
export const MAX_PAGE_LOCATION_LENGTH = 200;
export const MAX_GUEST_NAME_LENGTH = 100;
export const MAX_GUEST_NOTE_LENGTH = 1000;
export const MAX_PAGES_PER_USER = 20;
/** How many days of slots one public request returns, unless it asks for more. */
export const SLOT_DAYS_PER_REQUEST = 7;
/** The most one request may ask for: a month seen from any time zone, with a day either side. */
export const MAX_SLOT_DAYS = 42;
/** A page takes at most this many bookings a day, and one guest address this many upcoming ones. */
export const MAX_BOOKINGS_PER_DAY = 30;
export const MAX_UPCOMING_PER_GUEST = 3;
/** The highest daily cap a page can set; a day can't hold more slots than this anyway. */
export const MAX_PER_DAY_LIMIT = 100;

/** A `?days=` value, clamped; anything unreadable is the default. */
export function slotDays(value: string | null): number {
	const days = Number(value);
	return Number.isInteger(days) && days > 0 ? Math.min(days, MAX_SLOT_DAYS) : SLOT_DAYS_PER_REQUEST;
}
/** How close to the start a guest may still move or cancel, per page. */
export const RESCHEDULE_CUTOFF_HOURS = [1, 4, 12, 24, 48, 72, 168] as const;
export const DEFAULT_RESCHEDULE_CUTOFF_HOURS = 24;
/** Moves one booking can take from its guest, so a slot can't be shuffled forever. */
export const MAX_GUEST_RESCHEDULES = 3;
/** Addresses a page can invite to every booking, besides the guest. */
export const MAX_COLLABORATORS = 5;

const DAY_MS = 86_400_000;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export type ReservationPageSettings = {
	title: string;
	description: string | null;
	/** Where bookings take place, for a page that meets somewhere physical. */
	location: string | null;
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
	/** Guests may move or cancel until this many hours before the start. */
	rescheduleCutoffHours: number;
	/** Lowercase addresses invited to every booking with the guest. */
	collaborators: string[];
	/** How each booking's meeting room admits people; `null` for the defaults. */
	roomSettings: RoomSettings | null;
	/** The most bookings on one day, in the page's zone; `null` for no limit. */
	maxPerDay: number | null;
	/** Reminder emails to the guest before each booking. */
	reminders: ReminderSetting;
};

export type ReservationPage =ReservationPageSettings & { id: string };

/** What a guest sees: nothing about the owner's other events. */
export type PublicReservationPage = Pick<
	ReservationPageSettings,
	'title' | 'description' | 'location' | 'timeZone' | 'startDate' | 'endDate' | 'slotMinutes' | 'withMeeting'
> & { slug: string; host: string };

export type ReservationPageError =
	| 'invalid_title'
	| 'invalid_slug'
	| 'invalid_time_zone'
	| 'invalid_dates'
	| 'invalid_hours'
	| 'invalid_weekdays'
	| 'invalid_cutoff'
	| 'invalid_collaborators'
	| 'invalid_max_per_day'
	| 'invalid_reminders';

export type GuestInput = { name: string; email: string; note: string };

/** What a guest sees on the page for changing their own booking. */
export type ManagedBookingView = {
	pageTitle: string;
	host: string;
	location: string | null;
	meetingUrl: string | null;
	start: string;
	end: string;
	/** The page's zone and last date, for picking a new slot. */
	timeZone: string;
	endDate: string;
	/** Why it can't be moved any more, or `null`. */
	rescheduleBlock: GuestChangeBlock | null;
	/** Why it can't be cancelled any more, or `null`. */
	cancelBlock: GuestChangeBlock | null;
	reschedulesLeft: number;
	/** When changes stop being possible. */
	changeUntil: string;
};

/** Why a guest can no longer change their booking, or `null` if they can. */
export type GuestChangeBlock = 'past' | 'too_late' | 'limit_reached';

/**
 * The rules a guest's own change has to pass. Cancelling is only held to the
 * cutoff; moving also to the per-booking limit.
 */
export function guestChangeBlock(booking: {
	start: Date;
	now: Date;
	cutoffHours: number;
	rescheduleCount: number;
	action: 'reschedule' | 'cancel';
}): GuestChangeBlock | null {
	const lead = booking.start.getTime() - booking.now.getTime();
	if (lead <= 0) return 'past';
	if (lead < booking.cutoffHours * 3_600_000) return 'too_late';
	if (booking.action === 'reschedule' && booking.rescheduleCount >= MAX_GUEST_RESCHEDULES) return 'limit_reached';
	return null;
}
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

/** Lowercased and deduplicated; `null` when the list isn't a few valid addresses. Missing means none. */
export function cleanCollaborators(input: unknown): string[] | null {
	if (input === undefined || input === null) return [];
	if (!Array.isArray(input)) return null;
	const emails = new Set<string>();
	for (const entry of input) {
		const email = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
		if (!isPlausibleEmail(email)) return null;
		emails.add(email);
	}
	return emails.size <= MAX_COLLABORATORS ? [...emails] : null;
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
	const location = clean(input.location, MAX_PAGE_LOCATION_LENGTH) || null;
	const rescheduleCutoffHours = input.rescheduleCutoffHours ?? DEFAULT_RESCHEDULE_CUTOFF_HOURS;
	if (typeof rescheduleCutoffHours !== 'number' || !(RESCHEDULE_CUTOFF_HOURS as readonly number[]).includes(rescheduleCutoffHours)) {
		return { ok: false, error: 'invalid_cutoff' };
	}
	const collaborators = cleanCollaborators(input.collaborators);
	if (!collaborators) return { ok: false, error: 'invalid_collaborators' };
	const maxPerDay = input.maxPerDay ?? null;
	if (maxPerDay !== null && !isInt(maxPerDay, 1, MAX_PER_DAY_LIMIT)) return { ok: false, error: 'invalid_max_per_day' };
	const reminders = input.reminders === undefined ? DEFAULT_REMINDERS : parseReminderSetting(input.reminders);
	if (!reminders) return { ok: false, error: 'invalid_reminders' };
	return {
		ok: true,
		value: {
			title,
			description,
			location,
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
			withMeeting: input.withMeeting === true,
			rescheduleCutoffHours: rescheduleCutoffHours as number,
			collaborators,
			roomSettings: parseRoomSettings(input.roomSettings) ?? null,
			maxPerDay: maxPerDay as number | null,
			reminders
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
