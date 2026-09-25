/**
 * The invitation a guest of one of the user's events gets: a short email plus
 * an iTIP file (METHOD:REQUEST, or CANCEL once they're off it) with the UID
 * `<eventId>@zimail`, so their answers find their way back to the event.
 * Pure, so it can be tested without a provider.
 */
import type { InviteParty, PartStat } from '../../calendar/ics/invite';
import { icsDate, icsDocument, icsPerson, icsText, icsTime } from '../../calendar/ics/write';
import type { EmailContent } from '../outbound/email-template';

export type EventInvite = {
	uid: string;
	sequence: number;
	title: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	organizer: InviteParty;
	/** Everyone invited, so each guest's calendar shows who else is coming. */
	guests: (InviteParty & { status: PartStat })[];
	/** The organizer's zone, for the times written in the email. */
	timeZone: string;
};

/** `new` for someone just added, `updated` for a change they already knew of, `cancelled` for the event or their place in it. */
export type InviteNotice = 'new' | 'updated' | 'cancelled';

export function inviteMethod(notice: InviteNotice): 'REQUEST' | 'CANCEL' {
	return notice === 'cancelled' ? 'CANCEL' : 'REQUEST';
}

function formatWhen(invite: EventInvite): string {
	if (invite.allDay) {
		const format = (date: Date) => new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' }).format(date);
		const last = new Date(invite.end.getTime() - 86_400_000);
		return last.getTime() > invite.start.getTime() ? `${format(invite.start)} – ${format(last)}` : format(invite.start);
	}
	const date = new Intl.DateTimeFormat('en-US', {
		dateStyle: 'full',
		timeStyle: 'short',
		timeZone: invite.timeZone
	}).format(invite.start);
	const end = new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: invite.timeZone }).format(invite.end);
	return `${date} – ${end} (${invite.timeZone})`;
}

function organizerLabel(organizer: InviteParty): string {
	return organizer.name ? `${organizer.name} <${organizer.email}>` : organizer.email;
}

const TITLES: Record<InviteNotice, string> = {
	new: 'Invitation',
	updated: 'Updated invitation',
	cancelled: 'Cancelled'
};

export function inviteSubject(invite: EventInvite, notice: InviteNotice): string {
	return `${TITLES[notice]}: ${invite.title}`.slice(0, 200);
}

function lead(invite: EventInvite, notice: InviteNotice): string {
	const who = invite.organizer.name ?? invite.organizer.email;
	if (notice === 'cancelled') return `${who} cancelled this event. If it was on your calendar, it has been taken off.`;
	if (notice === 'updated') return `${who} changed this event. Your calendar updates when you open the invitation.`;
	return `${who} invited you. Accept the invitation to put it on your calendar.`;
}

export function inviteEmailContent(invite: EventInvite, notice: InviteNotice): EmailContent {
	const details = [
		{ label: notice === 'cancelled' ? 'Was' : 'When', value: formatWhen(invite) },
		{ label: 'Organizer', value: organizerLabel(invite.organizer) }
	];
	if (notice !== 'cancelled') {
		if (invite.location) details.push({ label: 'Where', value: invite.location });
		if (invite.guests.length > 0) {
			details.push({ label: 'Guests', value: invite.guests.map((guest) => guest.email).join(', ') });
		}
		if (invite.notes) details.push({ label: 'Notes', value: invite.notes });
	}
	return {
		title: inviteSubject(invite, notice),
		lead: lead(invite, notice),
		details,
		footer: 'Reply to this email to reach the organizer.'
	};
}

function timeLines(invite: EventInvite): string[] {
	return invite.allDay
		? [`DTSTART;VALUE=DATE:${icsDate(invite.start)}`, `DTEND;VALUE=DATE:${icsDate(invite.end)}`]
		: [`DTSTART:${icsTime(invite.start)}`, `DTEND:${icsTime(invite.end)}`];
}

function attendeeLine(guest: InviteParty & { status: PartStat }): string {
	return icsPerson('ATTENDEE', guest.email, guest.name, [
		'ROLE=REQ-PARTICIPANT',
		`PARTSTAT=${guest.status.toUpperCase()}`,
		'RSVP=TRUE'
	]);
}

export function inviteIcs(invite: EventInvite, notice: InviteNotice, now = new Date()): string {
	const method = inviteMethod(notice);
	return icsDocument([
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Zimail//Calendar//EN',
		'CALSCALE:GREGORIAN',
		`METHOD:${method}`,
		'BEGIN:VEVENT',
		`UID:${invite.uid}`,
		`SEQUENCE:${invite.sequence}`,
		`DTSTAMP:${icsTime(now)}`,
		...timeLines(invite),
		`SUMMARY:${icsText(invite.title)}`,
		`STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
		'TRANSP:OPAQUE',
		icsPerson('ORGANIZER', invite.organizer.email, invite.organizer.name),
		...invite.guests.map(attendeeLine),
		...(invite.location ? [`LOCATION:${icsText(invite.location)}`] : []),
		...(invite.notes ? [`DESCRIPTION:${icsText(invite.notes)}`] : []),
		'END:VEVENT',
		'END:VCALENDAR'
	]);
}
