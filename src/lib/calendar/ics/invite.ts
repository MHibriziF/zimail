/**
 * Reading an iTIP message (RFC 5546): the calendar part of an invitation, a
 * cancellation, or someone's answer to one. Pure, so the server and tests
 * share it.
 */
import { first, parseIcs, unescapeText, type IcsComponent, type IcsProperty } from './parse';
import { readSingleEvent } from './index';
import { resolveTzid } from './time';

export const INVITE_METHODS = ['REQUEST', 'CANCEL', 'REPLY', 'COUNTER', 'DECLINECOUNTER', 'PUBLISH'] as const;
export type InviteMethod = (typeof INVITE_METHODS)[number];

export const PART_STATS = ['accepted', 'tentative', 'declined', 'needs-action', 'delegated'] as const;
export type PartStat = (typeof PART_STATS)[number];
/** What the reader of an invitation can answer. */
export type InviteResponse = 'accepted' | 'tentative' | 'declined';

export type InviteParty = { email: string; name: string | null };
export type InviteAttendee = InviteParty & { status: PartStat; rsvp: boolean };

export type Invitation = {
	method: InviteMethod;
	uid: string;
	sequence: number;
	title: string;
	/** UTC instant, or midnight UTC of the first date when `allDay`. */
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	description: string | null;
	organizer: InviteParty | null;
	attendees: InviteAttendee[];
	/** The series repeats (RRULE) — the calendar gets every occurrence. */
	recurring: boolean;
	/** Set when this is about one occurrence of a series: that occurrence's id. */
	occurrenceId: string | null;
	/** A COUNTER's or REPLY's note from the sender. */
	comment: string | null;
};

const MAX_TEXT = 200;
const MAX_DESCRIPTION = 4000;

function text(component: IcsComponent, name: string, max: number): string | null {
	const value = first(component, name)?.value;
	return value ? unescapeText(value).trim().slice(0, max) || null : null;
}

/** `mailto:Ada@Example.com` → `ada@example.com`; `null` for anything that isn't an address. */
function mailto(value: string): string | null {
	const address = value.trim().replace(/^mailto:/i, '').trim().toLowerCase();
	return address.includes('@') ? address : null;
}

function party(property: IcsProperty | undefined): InviteParty | null {
	const email = property ? mailto(property.value) : null;
	return email ? { email, name: property?.params.CN?.trim() || null } : null;
}

function partStat(value: string | undefined): PartStat {
	const lower = (value ?? '').trim().toLowerCase();
	return PART_STATS.find((status) => status === lower) ?? 'needs-action';
}

function attendeesOf(component: IcsComponent): InviteAttendee[] {
	return (component.get('ATTENDEE') ?? []).flatMap((property) => {
		const found = party(property);
		return found
			? [{ ...found, status: partStat(property.params.PARTSTAT), rsvp: property.params.RSVP?.toUpperCase() === 'TRUE' }]
			: [];
	});
}

/** The series itself when the message carries one, else its first instance. */
function mainComponent(events: IcsComponent[]): IcsComponent | undefined {
	return events.find((component) => !component.has('RECURRENCE-ID')) ?? events[0];
}

/**
 * The invitation in an iCalendar part, or `null` when there's no event to
 * speak of. A part without METHOD is a plain published event (PUBLISH).
 */
export function readInvitation(ics: string, fallbackZone: string): Invitation | null {
	const calendar = parseIcs(ics);
	const method = INVITE_METHODS.find((entry) => entry === (calendar.method ?? 'PUBLISH'));
	const component = mainComponent(calendar.events);
	if (!method || !component) return null;

	const zone = resolveTzid(calendar.timeZone ?? undefined) ?? fallbackZone;
	const uid = first(component, 'UID')?.value.trim();
	const event = readSingleEvent(component, zone);
	if (!uid || !event) return null;

	const sequence = Number.parseInt(first(component, 'SEQUENCE')?.value ?? '0', 10);
	return {
		method,
		uid,
		sequence: Number.isFinite(sequence) && sequence > 0 ? sequence : 0,
		title: text(component, 'SUMMARY', MAX_TEXT) ?? '',
		start: event.start,
		end: event.end,
		allDay: event.allDay,
		location: text(component, 'LOCATION', MAX_TEXT),
		description: text(component, 'DESCRIPTION', MAX_DESCRIPTION),
		organizer: party(first(component, 'ORGANIZER')),
		attendees: attendeesOf(component),
		recurring: component.has('RRULE'),
		occurrenceId: component.has('RECURRENCE-ID') ? event.uid : null,
		comment: text(component, 'COMMENT', MAX_DESCRIPTION)
	};
}

/** The attendee among `addresses` (lower-cased) — which of the user's addresses was invited. */
export function findAttendee(invitation: Invitation, addresses: ReadonlySet<string>): InviteAttendee | null {
	return invitation.attendees.find((attendee) => addresses.has(attendee.email)) ?? null;
}
