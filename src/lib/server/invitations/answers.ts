/**
 * The organizer's side: what guests say back to an invitation the user sent.
 * A REPLY (going, maybe, not going) is recorded as it arrives. A COUNTER — a
 * guest proposing another time — waits for the user to accept or decline it.
 */
import { readInvitation, type Invitation, type InviteParty } from '../../calendar/ics/invite';
import type { AnswerAction, GuestAnswerView } from '../../calendar/invitations';
import type { InvitationsRepository, OwnEvent } from './repository';

/** The suffix of the UIDs Zimail gives the invitations it sends — the rest is the event's id. */
const OWN_UID_SUFFIX = '@zimail';

export type AnswerActionOutcome =
	| { type: 'ok'; answer: GuestAnswerView }
	| { type: 'not_found' }
	| { type: 'unsupported' }
	| { type: 'slot_taken' }
	| { type: 'not_sent' };

export type AnswersService = {
	/** A guest's answer carried by one of the user's messages, or `null` if it isn't one. */
	inspect(userId: string, emailId: string): Promise<GuestAnswerView | null>;
	act(userId: string, emailId: string, action: AnswerAction): Promise<AnswerActionOutcome>;
	/** Records a REPLY as it arrives; everything else is left for the user. */
	applyArrival(userId: string, ics: string): Promise<'applied' | 'ignored'>;
};

export type AnswersServiceDeps = {
	repo: Pick<InvitationsRepository, 'findOwnEvent' | 'setGuestStatus'>;
	loadCalendarPart: (userId: string, emailId: string) => Promise<string | null>;
	timeZone: (userId: string) => Promise<string>;
	/** Moves the event to the accepted time and sends every guest the update. */
	reschedule: (userId: string, event: OwnEvent, start: Date, end: Date) => Promise<'ok' | 'not_found' | 'slot_taken'>;
	/** Tells the guest their proposed time was turned down. */
	declineProposal: (userId: string, event: OwnEvent, proposal: Invitation, guest: InviteParty) => Promise<void>;
};

type Loaded = { invitation: Invitation; event: OwnEvent; guest: InviteParty };

export function ownEventId(uid: string): string | null {
	return uid.endsWith(OWN_UID_SUFFIX) ? uid.slice(0, -OWN_UID_SUFFIX.length) || null : null;
}

function toView({ invitation, event, guest }: Loaded): GuestAnswerView {
	const proposed =
		invitation.method === 'COUNTER' ? { start: invitation.start, end: invitation.end, allDay: invitation.allDay } : null;
	return {
		method: invitation.method === 'COUNTER' ? 'COUNTER' : 'REPLY',
		from: guest,
		status: invitation.attendees[0]?.status ?? 'needs-action',
		title: event.title,
		current: { start: event.start, end: event.end, allDay: event.allDay },
		proposed,
		comment: invitation.comment,
		outdated: event.sequence > invitation.sequence,
		applied: proposed !== null && proposed.start === event.start && proposed.end === event.end
	};
}

export function createAnswersService(deps: AnswersServiceDeps): AnswersService {
	const { repo } = deps;

	async function read(userId: string, ics: string): Promise<Loaded | null> {
		const invitation = readInvitation(ics, await deps.timeZone(userId));
		if (!invitation || (invitation.method !== 'REPLY' && invitation.method !== 'COUNTER')) return null;
		const eventId = ownEventId(invitation.uid);
		const guest = invitation.attendees[0];
		if (!eventId || !guest) return null;
		const event = await repo.findOwnEvent(userId, eventId);
		return event ? { invitation, event, guest: { email: guest.email, name: guest.name } } : null;
	}

	async function load(userId: string, emailId: string): Promise<Loaded | null> {
		const ics = await deps.loadCalendarPart(userId, emailId);
		return ics ? read(userId, ics) : null;
	}

	return {
		async inspect(userId, emailId) {
			const loaded = await load(userId, emailId);
			return loaded ? toView(loaded) : null;
		},

		async act(userId, emailId, action) {
			const loaded = await load(userId, emailId);
			if (!loaded) return { type: 'not_found' };
			const view = toView(loaded);
			if (view.method !== 'COUNTER' || view.applied || view.outdated) return { type: 'unsupported' };

			if (action === 'accept-proposal') {
				const { invitation, event } = loaded;
				const moved = await deps.reschedule(userId, event, new Date(invitation.start), new Date(invitation.end));
				if (moved !== 'ok') return { type: moved };
				const after = await repo.findOwnEvent(userId, event.id);
				return { type: 'ok', answer: toView({ ...loaded, event: after ?? event }) };
			}

			// Declining is nothing but telling the guest, so a failed send is the whole outcome.
			try {
				await deps.declineProposal(userId, loaded.event, loaded.invitation, loaded.guest);
			} catch (error) {
				console.error('Could not decline a proposed time', error);
				return { type: 'not_sent' };
			}
			return { type: 'ok', answer: view };
		},

		async applyArrival(userId, ics) {
			const loaded = await read(userId, ics);
			if (loaded?.invitation.method !== 'REPLY') return 'ignored';
			const status = loaded.invitation.attendees[0].status;
			return (await repo.setGuestStatus(userId, loaded.event.id, loaded.guest.email, status)) ? 'applied' : 'ignored';
		}
	};
}
