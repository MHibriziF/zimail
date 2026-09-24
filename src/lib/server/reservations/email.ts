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
	if (details.note) content.details!.push({ label: 'Note', value: details.note });
	return content;
}

/** The attachment's MIME type — mail clients read the method from here as well as from the file. */
export function inviteContentType(kind: InviteKind): string {
	return `text/calendar; method=${METHOD[kind]}; charset=UTF-8`;
}

function icsText(value: string): string {
	return value
		.replaceAll('\\', String.raw`\\`)
		.replaceAll(';', String.raw`\;`)
		.replaceAll(',', String.raw`\,`)
		.replaceAll(/\r?\n/g, String.raw`\n`);
}

/** Parameter values (CN) can't be escaped, only quoted — so quotes themselves are dropped. */
function icsParam(value: string): string {
	return `"${value.replaceAll('"', '')}"`;
}

function icsTime(date: Date): string {
	return `${date.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z`;
}

/** Folds at 75 octets as RFC 5545 asks; long summaries would otherwise break strict parsers. */
function fold(line: string): string {
	const chunks: string[] = [];
	for (let index = 0; index < line.length; index += 73) chunks.push(line.slice(index, index + 73));
	return chunks.join('\r\n ');
}

export function bookingIcs(details: BookingDetails, kind: InviteKind = 'request', now = new Date()): string {
	const summary = `${details.pageTitle} with ${details.hostName}`;
	const cancelled = kind === 'cancel';
	return [
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
		...(details.note ? [`DESCRIPTION:${icsText(details.note)}`] : []),
		'END:VEVENT',
		'END:VCALENDAR',
		''
	]
		.map(fold)
		.join('\r\n');
}
