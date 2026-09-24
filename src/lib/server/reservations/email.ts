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
};

export type InviteKind = 'request' | 'cancel';

const METHOD: Record<InviteKind, string> = { request: 'REQUEST', cancel: 'CANCEL' };

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
	if (kind === 'cancel') {
		return {
			title: `Cancelled: ${details.pageTitle}`,
			lead: `${details.hostName} cancelled your reservation. If it was on your calendar, it has been taken off.`,
			details: [{ label: 'Was', value: formatWhen(details) }, withHost],
			footer: 'Reply to this email to find another time.'
		};
	}
	const content: EmailContent = {
		title: `You're booked: ${details.pageTitle}`,
		lead: `${details.hostName} has your reservation. Accept the invitation to put it on your calendar.`,
		details: [{ label: 'When', value: formatWhen(details) }, withHost, { label: 'Name', value: details.guestName }],
		footer: 'Need to change something? Reply to this email.'
	};
	if (details.meetingUrl) {
		content.details!.push({ label: 'Meeting', value: details.meetingUrl });
		content.action = { label: 'Join the meeting', href: details.meetingUrl };
	}
	if (details.note) content.details!.push({ label: 'Note', value: details.note });
	return content;
}

/** The attachment's MIME type — mail clients read the method from here as well as from the file. */
export function inviteContentType(kind: InviteKind): string {
	return `text/calendar; method=${METHOD[kind]}; charset=UTF-8`;
}

function description(details: BookingDetails): string {
	return [details.meetingUrl ? `Join the Zimail meeting: ${details.meetingUrl}` : '', details.note]
		.filter(Boolean)
		.join('\n\n');
}

export function bookingIcs(details: BookingDetails, kind: InviteKind = 'request', now = new Date()): string {
	const summary = `${details.pageTitle} with ${details.hostName}`;
	const cancelled = kind === 'cancel';
	return icsDocument([
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Zimail//Reservations//EN',
		'CALSCALE:GREGORIAN',
		`METHOD:${METHOD[kind]}`,
		'BEGIN:VEVENT',
		`UID:${details.uid}`,
		// A calendar only applies an update whose SEQUENCE is higher than what it holds.
		`SEQUENCE:${cancelled ? 1 : 0}`,
		`DTSTAMP:${icsTime(now)}`,
		`DTSTART:${icsTime(details.start)}`,
		`DTEND:${icsTime(details.end)}`,
		`SUMMARY:${icsText(summary)}`,
		`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
		'TRANSP:OPAQUE',
		`ORGANIZER;CN=${icsParam(details.hostName)}:mailto:${details.hostEmail}`,
		`ATTENDEE;CN=${icsParam(details.guestName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${details.guestEmail}`,
		// LOCATION is what calendars show and link; URL is the standard field for it.
		...(details.meetingUrl ? [`LOCATION:${icsText(details.meetingUrl)}`, `URL:${details.meetingUrl}`] : []),
		...(description(details) ? [`DESCRIPTION:${icsText(description(details))}`] : []),
		'END:VEVENT',
		'END:VCALENDAR'
	]);
}
