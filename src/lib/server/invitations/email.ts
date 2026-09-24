/**
 * The answer sent back to an organizer: METHOD:REPLY with the same UID and
 * SEQUENCE and just the answering attendee, which is what makes Gmail, Outlook
 * and Apple Calendar mark that guest as going or not. Pure, so it can be
 * tested without a provider.
 */
import type { Invitation, InviteParty, InviteResponse } from '../../calendar/ics/invite';
import { icsDate, icsDocument, icsPerson, icsText, icsTime } from '../../calendar/ics/write';
import type { EmailContent } from '../outbound/email-template';

const PARTSTAT: Record<InviteResponse, string> = {
	accepted: 'ACCEPTED',
	tentative: 'TENTATIVE',
	declined: 'DECLINED'
};

/** Subject prefixes the big calendars use, so the reply reads the same in the organizer's inbox. */
const SUBJECT: Record<InviteResponse, string> = {
	accepted: 'Accepted',
	tentative: 'Tentatively accepted',
	declined: 'Declined'
};

const VERB: Record<InviteResponse, string> = {
	accepted: 'accepted',
	tentative: 'said maybe to',
	declined: 'declined'
};

function timeLines(invitation: Invitation): string[] {
	const start = new Date(invitation.start);
	const end = new Date(invitation.end);
	return invitation.allDay
		? [`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(end)}`]
		: [`DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`];
}

/** The occurrence's id is `uid#<original start>`; RECURRENCE-ID wants that start back. */
function recurrenceLine(invitation: Invitation): string[] {
	const key = Number(invitation.occurrenceId?.slice(invitation.occurrenceId.lastIndexOf('#') + 1));
	if (!invitation.occurrenceId || !Number.isFinite(key)) return [];
	const original = new Date(key);
	return [invitation.allDay ? `RECURRENCE-ID;VALUE=DATE:${icsDate(original)}` : `RECURRENCE-ID:${icsTime(original)}`];
}

export function replyIcs(
	invitation: Invitation,
	attendee: InviteParty,
	response: InviteResponse,
	now = new Date()
): string {
	const organizer = invitation.organizer!;
	return icsDocument([
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Zimail//Calendar//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:REPLY',
		'BEGIN:VEVENT',
		`UID:${invitation.uid}`,
		...recurrenceLine(invitation),
		`SEQUENCE:${invitation.sequence}`,
		`DTSTAMP:${icsTime(now)}`,
		...timeLines(invitation),
		`SUMMARY:${icsText(invitation.title)}`,
		icsPerson('ORGANIZER', organizer.email, organizer.name),
		icsPerson('ATTENDEE', attendee.email, attendee.name, [`PARTSTAT=${PARTSTAT[response]}`]),
		'END:VEVENT',
		'END:VCALENDAR'
	]);
}

export function replySubject(invitation: Invitation, response: InviteResponse): string {
	return `${SUBJECT[response]}: ${invitation.title || 'Invitation'}`.slice(0, 200);
}

export function replyEmailContent(invitation: Invitation, attendee: InviteParty, response: InviteResponse): EmailContent {
	const who = attendee.name ? `${attendee.name} (${attendee.email})` : attendee.email;
	return {
		title: replySubject(invitation, response),
		lead: `${who} has ${VERB[response]} this invitation.`,
		details: [{ label: 'Event', value: invitation.title || 'Invitation' }]
	};
}
