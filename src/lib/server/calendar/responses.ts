import { json } from '@sveltejs/kit';
import type { CalendarEventInput } from '../../calendar/events';
import type { CalendarWriteOutcome } from './service';

/** One mapping from service outcome to HTTP, shared by create and update. */
export function calendarWriteResponse(outcome: CalendarWriteOutcome, okStatus = 200): Response {
	switch (outcome.type) {
		case 'ok':
			return json({ event: outcome.event }, { status: okStatus });
		case 'invalid_title':
			return json({ error: 'Give the event a title.' }, { status: 400 });
		case 'invalid_time':
			return json({ error: 'The event has to end after it starts.' }, { status: 400 });
		case 'read_only':
			return json({ error: 'This event comes from another calendar and can’t be edited here.' }, { status: 409 });
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
		notes: text(body.notes)
	};
}
