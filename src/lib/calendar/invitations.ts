/**
 * What the invitation card above a message shows and can do — shared by the
 * server, which works it out, and both themes' cards.
 */
import type { InviteAttendee, InviteMethod, InviteParty, InviteResponse, PartStat } from './ics/invite';

export type { InviteParty } from './ics/invite';

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

export type EventTime = { start: string; end: string; allDay: boolean };

/** A guest's answer to an invitation the user sent: going or not, or a new time. */
export type GuestAnswerView = {
	method: 'REPLY' | 'COUNTER';
	from: InviteParty;
	status: PartStat;
	title: string;
	/** When the event is now. */
	current: EventTime;
	/** A COUNTER's suggested time. */
	proposed: EventTime | null;
	comment: string | null;
	/** The event has been changed since the guest wrote, so the proposal is about an older version. */
	outdated: boolean;
	/** The event is already at the proposed time. */
	applied: boolean;
	/** Other busy events the proposed time overlaps; accepting is refused while there are any. */
	conflicts: (EventTime & { title: string })[];
};

export type AnswerAction = 'accept-proposal' | 'decline-proposal';

const ANSWER_HEADLINES: Partial<Record<PartStat, string>> = {
	accepted: 'answer.accepted',
	tentative: 'answer.tentative',
	declined: 'answer.declined'
};

/** The message key for what a guest said: a new time, going, maybe, not going. */
export function answerHeadlineKey(answer: GuestAnswerView): string {
	if (answer.proposed) return 'answer.proposes';
	return ANSWER_HEADLINES[answer.status] ?? 'answer.noAnswer';
}

/** Whether the card still offers a choice about the proposed time. */
export function canSettleProposal(answer: GuestAnswerView): boolean {
	return answer.proposed !== null && !answer.applied && !answer.outdated;
}

/** Accepting is only offered when the proposed time is free; keeping the current time always is. */
export function canAcceptProposal(answer: GuestAnswerView): boolean {
	return canSettleProposal(answer) && answer.conflicts.length === 0;
}

export const INVITATION_RESPONSES: readonly InviteResponse[] = ['accepted', 'tentative', 'declined'];

/** How many guests are shown by name before the rest become "and N more". */
export const SHOWN_GUESTS = 4;

/** The other people invited: not the organizer, not the user. */
export function otherGuests(view: InvitationView): InviteAttendee[] {
	return view.attendees.filter((guest) => guest.email !== view.organizer?.email && guest.email !== view.me);
}

/** "Fri, Sep 25 · 10:30 – 11:00" in the reader's zone; all-day events as dates. */
export function formatInvitationWhen(view: EventTime, locale: string, timeZone: string): string {
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
