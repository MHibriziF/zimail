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
	/** Where it takes place, when the page meets somewhere physical. */
	location?: string | null;
	/** The guest's own link to move or cancel it, and until when it works. */
	manage?: { url: string; until: Date } | null;
	/** The revision this message is; defaults to 0 for a new booking and 1 for its cancellation. */
	sequence?: number;
};

/** `moved` is an update to the time — still a REQUEST, with a higher SEQUENCE. */
/** `guest-*`: the guest changed it themselves, through their link. */
export type InviteKind = 'request' | 'moved' | 'cancel' | 'guest-moved' | 'guest-cancel';

const METHOD: Record<InviteKind, string> = {
	request: 'REQUEST',
	moved: 'REQUEST',
	cancel: 'CANCEL',
	'guest-moved': 'REQUEST',
	'guest-cancel': 'CANCEL'
};

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
		`ATTENDEE;CN=${icsParam(details.guestName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${details.guestEmail}`,
		// LOCATION is what calendars show: the place when there is one, else the join link. URL always carries the link.
		...(details.location || details.meetingUrl ? [`LOCATION:${icsText(details.location ?? details.meetingUrl ?? '')}`] : []),
		...(details.meetingUrl ? [`URL:${details.meetingUrl}`] : []),
		...(description(details) ? [`DESCRIPTION:${icsText(description(details))}`] : []),
		'END:VEVENT',
		'END:VCALENDAR'
	]);
}
