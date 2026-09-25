import { json } from '@sveltejs/kit';
import { MAX_EVENT_GUESTS, type CalendarEventInput } from '../../calendar/events';
import type { CalendarWriteOutcome } from './service';

/** One mapping from service outcome to HTTP, shared by create and update. */
export function calendarWriteResponse(outcome: CalendarWriteOutcome, okStatus = 200): Response {
	switch (outcome.type) {
		case 'ok':
			return json({ event: outcome.event, guests: outcome.guests }, { status: okStatus });
		case 'invalid_title':
			return json({ error: 'Give the event a title.' }, { status: 400 });
		case 'invalid_time':
			return json({ error: 'The event has to end after it starts.' }, { status: 400 });
		case 'invalid_guests':
			return json({ error: `Invite up to ${MAX_EVENT_GUESTS} guests, each with a valid email address.` }, { status: 400 });
		case 'read_only':
			return json({ error: 'Bookings and events from subscribed calendars can’t be edited here.' }, { status: 409 });
		case 'not_found':
			return json({ error: 'Event not found' }, { status: 404 });
	}
}

/** Pulls the editable fields out of an untrusted JSON body. */
export async function readEventInput(request: Request): Promise<CalendarEventInput> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const text = (value: unknown) => (typeof value === 'string' ? value : '');
	return {
		title: text(body.title),
		start: text(body.start),
		end: text(body.end),
		allDay: body.allDay === true,
		location: text(body.location),
		notes: text(body.notes),
		guests: Array.isArray(body.guests) ? body.guests.map(text) : undefined,
		withMeeting: typeof body.withMeeting === 'boolean' ? body.withMeeting : undefined
	};
}
