/**
 * What the invitation card above a message shows and can do — shared by the
 * server, which works it out, and both themes' cards.
 */
import type { InviteAttendee, InviteMethod, InviteParty, InviteResponse, PartStat } from './ics/invite';

export type InvitationView = {
	method: InviteMethod;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	description: string | null;
	organizer: InviteParty | null;
	attendees: InviteAttendee[];
	/** Which of the attendees is the user, when invited by name. */
	me: string | null;
	recurring: boolean;
	/** About one occurrence of a series rather than the whole of it. */
	occurrence: boolean;
	/** The user's answer so far. */
	response: PartStat | null;
	onCalendar: boolean;
	/** A newer revision from the organizer has already been applied. */
	outdated: boolean;
	/** Answering sends a reply to the organizer; otherwise the user can only add or remove it. */
	canReply: boolean;
};

export type InvitationAction = InviteResponse | 'add' | 'remove';

export const INVITATION_RESPONSES: readonly InviteResponse[] = ['accepted', 'tentative', 'declined'];

/** How many guests are shown by name before the rest become "and N more". */
export const SHOWN_GUESTS = 4;

/** The other people invited: not the organizer, not the user. */
export function otherGuests(view: InvitationView): InviteAttendee[] {
	return view.attendees.filter((guest) => guest.email !== view.organizer?.email && guest.email !== view.me);
}

/** "Fri, Sep 25 · 10:30 – 11:00" in the reader's zone; all-day events as dates. */
export function formatInvitationWhen(view: InvitationView, locale: string, timeZone: string): string {
	const start = new Date(view.start);
	const end = new Date(view.end);
	if (view.allDay) {
		const date = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
		const last = new Date(end.getTime() - 86_400_000);
		return last.getTime() > start.getTime() ? `${date.format(start)} – ${date.format(last)}` : date.format(start);
	}
	const day = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone });
	const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
	const sameDay = day.format(start) === day.format(end);
	return sameDay
		? `${day.format(start)} · ${time.format(start)} – ${time.format(end)}`
		: `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}`;
}
