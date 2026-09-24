/**
 * The confirmation a guest gets after booking: a short email plus an .ics they
 * can add to their own calendar. Pure, so it can be tested without a provider.
 */
import type { EmailContent } from '../outbound/email-template';

export type BookingDetails = {
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

function formatWhen(details: BookingDetails): string {
	const date = new Intl.DateTimeFormat('en-US', {
		dateStyle: 'full',
		timeStyle: 'short',
		timeZone: details.timeZone
	}).format(details.start);
	const end = new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: details.timeZone }).format(details.end);
	return `${date} – ${end} (${details.timeZone})`;
}

export function bookingEmailContent(details: BookingDetails): EmailContent {
	const content: EmailContent = {
		title: `You're booked: ${details.pageTitle}`,
		lead: `${details.hostName} has your reservation. The invite is attached so you can add it to your calendar.`,
		details: [
			{ label: 'When', value: formatWhen(details) },
			{ label: 'With', value: `${details.hostName} <${details.hostEmail}>` },
			{ label: 'Name', value: details.guestName }
		],
		footer: 'Need to change something? Reply to this email.'
	};
	if (details.note) content.details!.push({ label: 'Note', value: details.note });
	return content;
}

function icsText(value: string): string {
	return value
		.replaceAll('\\', String.raw`\\`)
		.replaceAll(';', String.raw`\;`)
		.replaceAll(',', String.raw`\,`)
		.replaceAll(/\r?\n/g, String.raw`\n`);
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

export function bookingIcs(details: BookingDetails, now = new Date()): string {
	const summary = `${details.pageTitle} with ${details.hostName}`;
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Zimail//Reservations//EN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${details.uid}`,
		`DTSTAMP:${icsTime(now)}`,
		`DTSTART:${icsTime(details.start)}`,
		`DTEND:${icsTime(details.end)}`,
		`SUMMARY:${icsText(summary)}`,
		`ORGANIZER;CN=${icsText(details.hostName)}:mailto:${details.hostEmail}`,
		`ATTENDEE;CN=${icsText(details.guestName)}:mailto:${details.guestEmail}`,
		...(details.note ? [`DESCRIPTION:${icsText(details.note)}`] : []),
		'END:VEVENT',
		'END:VCALENDAR',
		''
	]
		.map(fold)
		.join('\r\n');
}
