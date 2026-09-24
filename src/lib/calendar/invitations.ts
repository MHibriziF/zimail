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
