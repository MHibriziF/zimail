import {
	eventInterval,
	isDeletableEvent,
	isReadOnlyEvent,
	validateEventInput,
	validateGuests,
	type CalendarEvent,
	type CalendarEventInput,
	type EventGuest
} from '../../calendar/events';
import type { MeetingRooms } from '../reservations/service';
import type { InviteNotice } from './email';
import type { CalendarRepository } from './repository';

export type CalendarWriteOutcome =
	| { type: 'ok'; event: CalendarEvent; guests: EventGuest[] }
	| { type: 'invalid_title' }
	| { type: 'invalid_time' }
	| { type: 'invalid_guests' }
	| { type: 'read_only' }
	| { type: 'not_found' };

export type CalendarRangeOutcome = { type: 'ok'; events: CalendarEvent[] } | { type: 'invalid_range' };

/** Enough for a six-week grid plus a margin; a year-long agenda would need paging. */
export const MAX_RANGE_DAYS = 100;
const MAX_EVENTS_PER_RANGE = 1000;
const DAY_MS = 86_400_000;

export type CalendarService = {
	/**
	 * Events overlapping `[from, to)` as seen from `timeZone`. The query is padded
	 * by a day each side because an all-day event's stored instants are UTC dates,
	 * not the zone's, and then filtered exactly.
	 */
	listBetween(userId: string, from: Date, to: Date, timeZone: string): Promise<CalendarRangeOutcome>;
	get(userId: string, id: string): Promise<{ event: CalendarEvent; guests: EventGuest[] } | null>;
	create(userId: string, input: CalendarEventInput): Promise<CalendarWriteOutcome>;
	update(userId: string, id: string, input: CalendarEventInput): Promise<CalendarWriteOutcome>;
	remove(userId: string, id: string): Promise<'ok' | 'read_only' | 'not_found'>;
	/** Moves one of the user's own events — a guest's proposed time, accepted — and tells every guest. */
	reschedule(userId: string, id: string, start: Date, end: Date): Promise<'ok' | 'not_found'>;
};

type EventFields = Pick<CalendarEvent, 'title' | 'start' | 'end' | 'allDay' | 'location' | 'notes' | 'meetingCode'>;

/** One notice to some of an event's guests, about the event as it now stands. */
export type GuestMail = {
	event: EventFields & { id: string; sequence: number };
	notice: InviteNotice;
	to: string[];
	/** The guests the invitation file names: everyone, or for a dropped guest's cancellation just them. */
	attendees: EventGuest[];
};

export type CalendarServiceDeps = {
	repo: CalendarRepository;
	/** Cancels a booking and tells the guest; without it, the event is just deleted. */
	cancelReservation?: (userId: string, id: string) => Promise<boolean>;
	/** Emails the invitations; without it, the guest list is kept but nobody is told. */
	notifyGuests?: (userId: string, mail: GuestMail) => Promise<void>;
	/** Meeting rooms for events; without it, an event asking for one goes without. */
	meetings?: MeetingRooms | null;
};

const FIELDS = ['title', 'start', 'end', 'allDay', 'location', 'notes', 'meetingCode'] as const;

function changedFields(before: EventFields, after: EventFields) {
	const differs = (field: (typeof FIELDS)[number]) => before[field] !== after[field];
	return { moved: differs('start') || differs('end') || differs('allDay'), any: FIELDS.some(differs) };
}

function newGuest(email: string): EventGuest {
	return { email, name: null, status: 'needs-action' };
}

export function createCalendarService({
	repo,
	cancelReservation,
	notifyGuests,
	meetings
}: CalendarServiceDeps): CalendarService {
	/** A failure saves the event without a room rather than not at all. */
	async function openRoom(userId: string, title: string): Promise<string | null> {
		if (!meetings) return null;
		try {
			return await meetings.open(userId, title);
		} catch (error_) {
			console.error('Could not open a meeting room for an event', error_);
			return null;
		}
	}

	async function closeRoom(userId: string, code: string | null): Promise<void> {
		if (code) await meetings?.close(userId, code).catch(() => undefined);
	}

	/** Opens or closes the event's room as asked; `undefined` leaves it as it is. */
	async function syncRoom(userId: string, event: CalendarEvent, wanted: boolean | undefined): Promise<string | null> {
		if (wanted === undefined || wanted === (event.meetingCode !== null)) return event.meetingCode;
		const code = wanted ? await openRoom(userId, event.title) : null;
		if (code === event.meetingCode) return code;
		await repo.setMeetingCode(userId, event.id, code);
		await closeRoom(userId, event.meetingCode);
		return code;
	}

	/** Best effort: the calendar has already changed whether or not the emails go out. */
	async function tell(userId: string, mail: GuestMail): Promise<void> {
		if (!notifyGuests || mail.to.length === 0) return;
		try {
			await notifyGuests(userId, mail);
		} catch (error_) {
			console.error('Could not email event guests', error_);
		}
	}

	/** New guests get the invitation, existing ones the change (if there was one), dropped ones a cancellation. */
	async function announce(
		userId: string,
		event: GuestMail['event'],
		before: EventGuest[],
		after: EventGuest[],
		changed: boolean
	): Promise<void> {
		const had = new Set(before.map((guest) => guest.email));
		const has = new Set(after.map((guest) => guest.email));
		const removed = before.filter((guest) => !has.has(guest.email));
		const added = after.filter((guest) => !had.has(guest.email)).map((guest) => guest.email);
		const kept = changed ? after.filter((guest) => had.has(guest.email)).map((guest) => guest.email) : [];
		await Promise.all([
			tell(userId, { event, notice: 'new', to: added, attendees: after }),
			tell(userId, { event, notice: 'updated', to: kept, attendees: after }),
			tell(userId, {
				event,
				notice: 'cancelled',
				to: removed.map((guest) => guest.email),
				attendees: removed
			})
		]);
	}

	async function removeManual(userId: string, event: CalendarEvent): Promise<boolean> {
		const guests = await repo.listGuests(userId, event.id);
		const sequence = await repo.deleteManual(userId, event.id);
		if (sequence === null) return false;
		await closeRoom(userId, event.meetingCode);
		await tell(userId, {
			event: { ...event, sequence: sequence + 1 },
			notice: 'cancelled',
			to: guests.map((guest) => guest.email),
			attendees: guests
		});
		return true;
	}

	function removeBySource(userId: string, event: CalendarEvent): Promise<boolean> {
		if (event.source === 'reservation') return (cancelReservation ?? repo.deleteReservation)(userId, event.id);
		if (event.source === 'invite') return repo.deleteInvite(userId, event.id);
		return removeManual(userId, event);
	}

	async function update(userId: string, id: string, input: CalendarEventInput): Promise<CalendarWriteOutcome> {
		const existing = await repo.get(userId, id);
		if (!existing) return { type: 'not_found' };
		if (isReadOnlyEvent(existing)) return { type: 'read_only' };

		const valid = validateEventInput(input);
		if (!valid.ok) return { type: valid.error };
		const emails = input.guests === undefined ? null : validateGuests(input.guests);
		if (input.guests !== undefined && !emails) return { type: 'invalid_guests' };

		const before = await repo.listGuests(userId, id);
		const sequence = await repo.updateManual(userId, id, valid.value);
		if (sequence === null) return { type: 'not_found' };

		const meetingCode = await syncRoom(userId, { ...existing, ...valid.value }, input.withMeeting);
		const changed = changedFields(existing, { ...valid.value, meetingCode });
		// A new time needs everyone to answer again, as Google and Outlook ask.
		if (emails || (changed.moved && before.length > 0)) {
			await repo.setGuests(userId, id, emails ?? before.map((guest) => guest.email), changed.moved);
		}
		const guests = await repo.listGuests(userId, id);
		const event = { ...existing, ...valid.value, meetingCode };
		await announce(userId, { ...event, sequence }, before, guests, changed.any);
		return { type: 'ok', event, guests };
	}

	return {
		async listBetween(userId, from, to, timeZone) {
			const span = to.getTime() - from.getTime();
			if (Number.isNaN(span) || span <= 0 || span > MAX_RANGE_DAYS * DAY_MS) return { type: 'invalid_range' };

			const rows = await repo.listOverlapping(
				userId,
				new Date(from.getTime() - DAY_MS).toISOString(),
				new Date(to.getTime() + DAY_MS).toISOString(),
				MAX_EVENTS_PER_RANGE
			);
			const events = rows.filter((event) => {
				const interval = eventInterval(event, timeZone);
				return interval.start < to && interval.end > from;
			});
			return { type: 'ok', events };
		},

		async get(userId, id) {
			const event = await repo.get(userId, id);
			if (!event) return null;
			return { event, guests: event.source === 'manual' ? await repo.listGuests(userId, id) : [] };
		},

		async create(userId, input) {
			const valid = validateEventInput(input);
			if (!valid.ok) return { type: valid.error };
			const emails = validateGuests(input.guests ?? []);
			if (!emails) return { type: 'invalid_guests' };

			const event: CalendarEvent = {
				id: crypto.randomUUID(),
				...valid.value,
				source: 'manual',
				busy: true,
				calendar: null,
				meetingCode: input.withMeeting ? await openRoom(userId, valid.value.title) : null
			};
			await repo.insert({ ...valid.value, id: event.id, userId, source: 'manual', meetingCode: event.meetingCode });
			if (emails.length > 0) await repo.setGuests(userId, event.id, emails, false);
			const guests = emails.map(newGuest);
			await announce(userId, { ...event, sequence: 0 }, [], guests, false);
			return { type: 'ok', event, guests };
		},

		update,

		async reschedule(userId, id, start, end) {
			const existing = await repo.get(userId, id);
			if (existing?.source !== 'manual') return 'not_found';
			const outcome = await update(userId, id, {
				...existing,
				start: start.toISOString(),
				end: end.toISOString()
			});
			return outcome.type === 'ok' ? 'ok' : 'not_found';
		},

		async remove(userId, id) {
			const existing = await repo.get(userId, id);
			if (!existing) return 'not_found';
			if (!isDeletableEvent(existing)) return 'read_only';
			return (await removeBySource(userId, existing)) ? 'ok' : 'not_found';
		}
	};
}
