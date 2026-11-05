/**
 * What a guest gets when a booking is made or cancelled: a short email plus a
 * calendar invitation. Pure, so it can be tested without a provider.
 *
 * The invitation is iTIP (RFC 5546), not a plain .ics file: METHOD:REQUEST
 * with the host as ORGANIZER and the guest as an RSVP attendee is what makes
 * Gmail, Outlook and Apple Mail show an invitation card and put the event on
 * the guest's calendar. A later METHOD:CANCEL with the same UID and a higher
 * SEQUENCE takes it off again.
 */
import { icsDocument, icsParam, icsText, icsTime } from '../../calendar/ics/write';
import type { EmailContent } from '../outbound/email-template';
import { googleCalendarLink, outlookCalendarLink, type CalendarLinkEvent } from '../../calendar/add-to-calendar';
import type { ReminderKind } from '../../calendar/reminders';

export type BookingDetails = {
	/** Stable per booking — the cancellation has to name the same event. */
	uid: string;
	pageTitle: string;
	hostName: string;
	hostEmail: string;
	guestName: string;
	guestEmail: string;
	note: string;
	start: Date;
	end: Date;
	/** The page's zone, so the email states the time the way the host set it up. */
	timeZone: string;
	/** The booking's Zimail meeting room, if the page gives one. */
	meetingUrl?: string | null;
	/** Where it takes place, when the page meets somewhere physical. */
	location?: string | null;
	/** The guest's own link to move or cancel it, and until when it works. */
	manage?: { url: string; until: Date } | null;
	/** The revision this message is; defaults to 0 for a new booking and 1 for its cancellation. */
	sequence?: number;
	/** Invited alongside the guest, on the same message and as attendees. */
	collaborators?: string[];
};

/** Everyone the invitation goes to: the guest first, then the page's collaborators. */
export function bookingRecipients(details: BookingDetails): string[] {
	return [details.guestEmail, ...(details.collaborators ?? [])];
}

/** `moved` is an update to the time — still a REQUEST, with a higher SEQUENCE. */
/** `guest-*`: the guest changed it themselves, through their link. */
/** `publish`: a file the guest downloads and imports, not an invitation to answer. */
export type InviteKind = 'request' | 'moved' | 'cancel' | 'guest-moved' | 'guest-cancel' | 'publish';

const METHOD: Record<InviteKind, string> = {
	request: 'REQUEST',
	moved: 'REQUEST',
	cancel: 'CANCEL',
	'guest-moved': 'REQUEST',
	'guest-cancel': 'CANCEL',
	publish: 'PUBLISH'
};

/** The event as calendars show it, shared by the invitation and the add-to-calendar links. */
function calendarEvent(details: BookingDetails): CalendarLinkEvent {
	return {
		title: `${details.pageTitle} with ${details.hostName}`,
		start: details.start,
		end: details.end,
		description: description(details) || undefined,
		location: details.location ?? details.meetingUrl ?? undefined
	};
}

/** For mail that doesn't turn the invitation into an event by itself. */
function addToCalendar(details: BookingDetails): NonNullable<EmailContent['links']> {
	const event = calendarEvent(details);
	const items = [
		{ label: 'Google Calendar', href: googleCalendarLink(event) },
		{ label: 'Outlook', href: outlookCalendarLink(event) }
	];
	if (details.manage) items.push({ label: 'Download .ics', href: `${details.manage.url}/ics` });
	return { label: 'Add to calendar', items };
}

const isCancel = (kind: InviteKind) => kind === 'cancel' || kind === 'guest-cancel';

function formatWhen(details: BookingDetails): string {
	const date = new Intl.DateTimeFormat('en-US', {
		dateStyle: 'full',
		timeStyle: 'short',
		timeZone: details.timeZone
	}).format(details.start);
	const end = new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: details.timeZone }).format(details.end);
	return `${date} – ${end} (${details.timeZone})`;
}

export function bookingEmailContent(details: BookingDetails, kind: InviteKind = 'request'): EmailContent {
	const withHost = { label: 'With', value: `${details.hostName} <${details.hostEmail}>` };
	if (isCancel(kind)) {
		// The host gets a copy of what the guest did, so this reads right to both.
		const who = kind === 'guest-cancel' ? `${details.guestName} cancelled this reservation.` : `${details.hostName} cancelled your reservation.`;
		return {
			title: `Cancelled: ${details.pageTitle}`,
			lead: `${who} If it was on your calendar, it has been taken off.`,
			details: [
			{ label: 'Was', value: formatWhen(details) },
			withHost,
			...(details.location ? [{ label: 'Where', value: details.location }] : [])
		],
			footer: 'Reply to this email to find another time.'
		};
	}
	const content: EmailContent = {
		title: kind === 'request' ? `You're booked: ${details.pageTitle}` : `New time: ${details.pageTitle}`,
		lead: bookingLead(details, kind),
		details: [{ label: 'When', value: formatWhen(details) }, withHost, { label: 'Name', value: details.guestName }],
		links: addToCalendar(details),
		footer: details.manage
			? `You can reschedule or cancel with the link above until ${formatWhen({ ...details, start: details.manage.until })}. After that, reply to this email.`
			: 'Need to change something? Reply to this email.'
	};
	if (details.manage) content.details!.push({ label: 'Change or cancel', value: details.manage.url });
	if (details.location) content.details!.push({ label: 'Where', value: details.location });
	if (details.meetingUrl) {
		content.details!.push({ label: 'Meeting', value: details.meetingUrl });
		content.action = { label: 'Join the meeting', href: details.meetingUrl };
	}
	if (details.collaborators?.length) content.details!.push({ label: 'Guests', value: bookingRecipients(details).join(', ') });
	if (details.note) content.details!.push({ label: 'Note', value: details.note });
	return content;
}

/** The reminder before a booking. No invitation attached: the guest already has (or chose not to keep) the event. */
export function bookingReminderContent(details: BookingDetails, kind: ReminderKind): EmailContent {
	const when = kind === 'day' ? 'tomorrow' : 'in about an hour';
	const content: EmailContent = {
		title: `Reminder: ${details.pageTitle} ${when}`,
		lead: `Your reservation with ${details.hostName} starts ${when}.`,
		details: [{ label: 'When', value: formatWhen(details) }, { label: 'With', value: `${details.hostName} <${details.hostEmail}>` }],
		links: addToCalendar(details),
		footer: 'Need to change it? Use the link in your confirmation email, or reply to this email.'
	};
	if (details.location) content.details!.push({ label: 'Where', value: details.location });
	if (details.meetingUrl) {
		content.details!.push({ label: 'Meeting', value: details.meetingUrl });
		content.action = { label: 'Join the meeting', href: details.meetingUrl };
	}
	if (details.note) content.details!.push({ label: 'Note', value: details.note });
	return content;
}

function bookingLead(details: BookingDetails, kind: InviteKind): string {
	if (kind === 'guest-moved') return `${details.guestName} moved this reservation to the time below. Calendars update when the invitation is accepted.`;
	if (kind === 'moved') return `${details.hostName} moved your reservation to the time below. Your calendar updates when you accept.`;
	return `${details.hostName} has your reservation. Accept the invitation to put it on your calendar.`;
}

export function bookingMethod(kind: InviteKind): string {
	return METHOD[kind];
}

function description(details: BookingDetails): string {
	return [details.meetingUrl ? `Join the Zimail meeting: ${details.meetingUrl}` : '', details.note]
		.filter(Boolean)
		.join('\n\n');
}

function attendeeLines(details: BookingDetails): string[] {
	return [
		`ATTENDEE;CN=${icsParam(details.guestName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${details.guestEmail}`,
		...(details.collaborators ?? []).map((email) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`)
	];
}

export function bookingIcs(details: BookingDetails, kind: InviteKind = 'request', now = new Date()): string {
	const summary = `${details.pageTitle} with ${details.hostName}`;
	const cancelled = isCancel(kind);
	return icsDocument([
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Zimail//Reservations//EN',
		'CALSCALE:GREGORIAN',
		`METHOD:${METHOD[kind]}`,
		'BEGIN:VEVENT',
		`UID:${details.uid}`,
		// A calendar only applies an update whose SEQUENCE is higher than what it holds.
		`SEQUENCE:${details.sequence ?? (cancelled ? 1 : 0)}`,
		`DTSTAMP:${icsTime(now)}`,
		`DTSTART:${icsTime(details.start)}`,
		`DTEND:${icsTime(details.end)}`,
		`SUMMARY:${icsText(summary)}`,
		`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
		'TRANSP:OPAQUE',
		`ORGANIZER;CN=${icsParam(details.hostName)}:mailto:${details.hostEmail}`,
		// An imported file is just the event; attendees with RSVP would make some apps treat it as an invitation to answer.
		...(kind === 'publish' ? [] : attendeeLines(details)),
		// LOCATION is what calendars show: the place when there is one, else the join link. URL always carries the link.
		...(details.location || details.meetingUrl ? [`LOCATION:${icsText(details.location ?? details.meetingUrl ?? '')}`] : []),
		...(details.meetingUrl ? [`URL:${details.meetingUrl}`] : []),
		...(description(details) ? [`DESCRIPTION:${icsText(description(details))}`] : []),
		'END:VEVENT',
		'END:VCALENDAR'
	]);
}
