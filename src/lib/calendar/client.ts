import type { ReservationPage, ReservationPageSettings } from './reservations';
import type { CalendarFeed } from './feeds';
import type { LabelColor } from '../mail/labels';
import type { CalendarEvent, CalendarEventInput } from './events';
import type { InvitationAction, InvitationView } from './invitations';

export class CalendarRequestError extends Error {}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
	const body = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new CalendarRequestError(body.error ?? fallback);
	return body;
}

export async function fetchEvents(from: Date, to: Date, timeZone: string): Promise<CalendarEvent[]> {
	const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), tz: timeZone });
	const response = await fetch(`/api/calendar/events?${query}`);
	return (await readJson<{ events: CalendarEvent[] }>(response, 'Could not load events')).events;
}

/** Creates when `id` is missing, otherwise replaces that event. */
export async function saveEvent(input: CalendarEventInput, id?: string): Promise<CalendarEvent> {
	const response = await fetch(id ? `/api/calendar/events/${encodeURIComponent(id)}` : '/api/calendar/events', {
		method: id ? 'PATCH' : 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	return (await readJson<{ event: CalendarEvent }>(response, 'Could not save the event')).event;
}

export async function deleteEvent(id: string): Promise<void> {
	const response = await fetch(`/api/calendar/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
	await readJson(response, 'Could not delete the event');
}

export async function fetchFeeds(): Promise<CalendarFeed[]> {
	return (await readJson<{ feeds: CalendarFeed[] }>(await fetch('/api/calendar/feeds'), 'Could not load calendars')).feeds;
}

export async function addFeed(input: { name: string; url: string; color: LabelColor }): Promise<CalendarFeed> {
	const response = await fetch('/api/calendar/feeds', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input)
	});
	return (await readJson<{ feed: CalendarFeed }>(response, 'Could not add the calendar')).feed;
}

export async function syncFeed(id: string): Promise<CalendarFeed> {
	const response = await fetch(`/api/calendar/feeds/${encodeURIComponent(id)}/sync`, { method: 'POST' });
	return (await readJson<{ feed: CalendarFeed }>(response, 'Could not sync the calendar')).feed;
}

export async function removeFeed(id: string): Promise<void> {
	const response = await fetch(`/api/calendar/feeds/${encodeURIComponent(id)}`, { method: 'DELETE' });
	await readJson(response, 'Could not remove the calendar');
}

/** The invitation a message carries, or `null` when it has none to act on. */
export async function fetchInvitation(emailId: string): Promise<InvitationView | null> {
	const response = await fetch(`/api/mail/${encodeURIComponent(emailId)}/invitation`);
	return (await readJson<{ invitation: InvitationView | null }>(response, 'Could not read the invitation')).invitation;
}

export async function actOnInvitation(
	emailId: string,
	action: InvitationAction
): Promise<{ invitation: InvitationView; replied: boolean }> {
	const response = await fetch(`/api/mail/${encodeURIComponent(emailId)}/invitation`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action })
	});
	return readJson(response, 'Could not update the invitation');
}

export async function fetchReservationPages(): Promise<{ pages: ReservationPage[]; meetingsAvailable: boolean }> {
	return readJson<{ pages: ReservationPage[]; meetingsAvailable: boolean }>(
		await fetch('/api/reservations'),
		'Could not load pages'
	);
}

/** Creates when `id` is missing, otherwise replaces that page's settings. */
export async function saveReservationPage(settings: ReservationPageSettings, id?: string): Promise<ReservationPage> {
	const response = await fetch(id ? `/api/reservations/${encodeURIComponent(id)}` : '/api/reservations', {
		method: id ? 'PATCH' : 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(settings)
	});
	return (await readJson<{ page: ReservationPage }>(response, 'Could not save the page')).page;
}

export async function deleteReservationPage(id: string): Promise<void> {
	await readJson(await fetch(`/api/reservations/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Could not delete the page');
}
