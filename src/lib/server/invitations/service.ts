import { expandCalendar } from '../../calendar/ics';
import {
	findAttendee,
	readInvitation,
	type Invitation,
	type InviteAttendee,
	type InviteMethod,
	type InviteParty,
	type InviteResponse,
	type PartStat
} from '../../calendar/ics/invite';
import type { InvitationAction, InvitationView } from '../../calendar/invitations';
import type { InvitationsRepository, InviteEventRow, StoredInvite } from './repository';

export type { InvitationAction, InvitationView } from '../../calendar/invitations';

const DAY_MS = 86_400_000;
/** How far a repeating invitation is filled in. Unlike a feed it isn't re-synced, so this is its reach. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 366;
const MAX_OCCURRENCES = 500;

/** Methods this module acts on; answers to the user's own invitations are handled elsewhere. */
const RECEIVED_METHODS: ReadonlySet<InviteMethod> = new Set(['REQUEST', 'PUBLISH', 'CANCEL']);

export type InvitationActionOutcome =
	| { type: 'ok'; view: InvitationView; replied: boolean }
	| { type: 'not_found' }
	| { type: 'outdated' }
	| { type: 'unsupported' };

export type InvitationsService = {
	/** The invitation in one of the user's messages, or `null` if it has none this module handles. */
	inspect(userId: string, emailId: string): Promise<InvitationView | null>;
	act(userId: string, emailId: string, action: InvitationAction): Promise<InvitationActionOutcome>;
	/**
	 * Applies an organizer's update or cancellation as it arrives — but only to
	 * an invitation the user already acted on, so a stranger's invitation never
	 * lands on the calendar unasked.
	 */
	applyArrival(userId: string, ics: string): Promise<'applied' | 'ignored'>;
};

export type InvitationsServiceDeps = {
	repo: InvitationsRepository;
	/** The calendar part of one of the user's messages, as text. */
	loadCalendarPart: (userId: string, emailId: string) => Promise<string | null>;
	ownAddresses: (userId: string) => Promise<string[]>;
	/** For floating times, when the invitation doesn't name a zone. */
	timeZone: (userId: string) => Promise<string>;
	/** Sends the answer to the organizer from `attendee.email`. */
	sendReply: (userId: string, invitation: Invitation, attendee: InviteParty, response: InviteResponse) => Promise<void>;
	now?: () => Date;
};

type Loaded = { invitation: Invitation; ics: string; zone: string; me: InviteAttendee | null; own: Set<string> };

const RESPONSES: ReadonlySet<InvitationAction> = new Set(['accepted', 'tentative', 'declined']);

function isResponse(action: InvitationAction): action is InviteResponse {
	return RESPONSES.has(action);
}

function isGoing(response: PartStat | null | undefined): boolean {
	return response === 'accepted' || response === 'tentative';
}

export function createInvitationsService(deps: InvitationsServiceDeps): InvitationsService {
	const { repo } = deps;
	const now = deps.now ?? (() => new Date());

	async function parse(userId: string, ics: string): Promise<Omit<Loaded, 'ics'> | null> {
		const zone = await deps.timeZone(userId);
		const invitation = readInvitation(ics, zone);
		if (!invitation || !RECEIVED_METHODS.has(invitation.method)) return null;
		const own = new Set((await deps.ownAddresses(userId)).map((address) => address.toLowerCase()));
		return { invitation, zone, me: findAttendee(invitation, own), own };
	}

	async function load(userId: string, emailId: string): Promise<Loaded | null> {
		const ics = await deps.loadCalendarPart(userId, emailId);
		const parsed = ics ? await parse(userId, ics) : null;
		return parsed && ics ? { ...parsed, ics } : null;
	}

	function canReply({ invitation, me, own }: Loaded): boolean {
		return (
			invitation.method === 'REQUEST' &&
			me !== null &&
			invitation.organizer !== null &&
			!own.has(invitation.organizer.email)
		);
	}

	function isOutdated(invitation: Invitation, stored: StoredInvite | null): boolean {
		return stored !== null && stored.sequence > invitation.sequence;
	}

	async function view(userId: string, loaded: Loaded): Promise<InvitationView> {
		const { invitation } = loaded;
		const stored = await repo.get(userId, invitation.uid);
		return {
			method: invitation.method,
			title: invitation.title,
			start: invitation.start,
			end: invitation.end,
			allDay: invitation.allDay,
			location: invitation.location,
			description: invitation.description,
			organizer: invitation.organizer,
			attendees: invitation.attendees,
			me: loaded.me?.email ?? null,
			recurring: invitation.recurring,
			occurrence: invitation.occurrenceId !== null,
			response: stored?.response ?? null,
			onCalendar: await repo.hasEvents(userId, invitation.uid),
			outdated: isOutdated(invitation, stored),
			canReply: canReply(loaded)
		};
	}

	function notesFor(invitation: Invitation): string | null {
		const organizer = invitation.organizer;
		const from = organizer ? `Organizer: ${organizer.name ? `${organizer.name} <${organizer.email}>` : organizer.email}` : '';
		return [from, invitation.description ?? ''].filter(Boolean).join('\n\n').slice(0, 4000) || null;
	}

	/** Puts the invitation on the calendar, replacing whatever an earlier revision put there. */
	async function place(userId: string, { invitation, ics, zone }: Pick<Loaded, 'invitation' | 'ics' | 'zone'>) {
		const notes = notesFor(invitation);
		if (invitation.occurrenceId) {
			await repo.replaceOccurrence(userId, invitation.uid, invitation.occurrenceId, {
				id: crypto.randomUUID(),
				externalUid: invitation.occurrenceId,
				title: invitation.title || 'Invitation',
				start: invitation.start,
				end: invitation.end,
				allDay: invitation.allDay,
				location: invitation.location,
				notes,
				busy: true
			});
			return;
		}

		const at = now().getTime();
		const from = Math.min(at - PAST_DAYS * DAY_MS, Date.parse(invitation.start));
		const to = Math.max(at + FUTURE_DAYS * DAY_MS, Date.parse(invitation.end) + DAY_MS);
		const prefix = `${invitation.uid}#`;
		const rows: InviteEventRow[] = expandCalendar(ics, {
			from: new Date(from),
			to: new Date(to),
			fallbackTimeZone: zone,
			limit: MAX_OCCURRENCES
		})
			.filter((event) => event.uid.startsWith(prefix))
			.map((event) => ({
				id: crypto.randomUUID(),
				externalUid: event.uid,
				title: invitation.title || event.title,
				start: event.start,
				end: event.end,
				allDay: event.allDay,
				location: event.location,
				notes,
				busy: event.busy
			}));
		await repo.replaceEvents(userId, invitation.uid, rows);
	}

	async function takeOff(userId: string, invitation: Invitation) {
		if (invitation.occurrenceId) await repo.replaceOccurrence(userId, invitation.uid, invitation.occurrenceId, null);
		else await repo.removeEvents(userId, invitation.uid);
	}

	async function record(userId: string, invitation: Invitation, stored: StoredInvite | null, response: PartStat | null) {
		await repo.save(userId, {
			uid: invitation.uid,
			sequence: Math.max(stored?.sequence ?? 0, invitation.sequence),
			response
		});
	}

	async function reply(userId: string, loaded: Loaded, response: InviteResponse): Promise<boolean> {
		if (!canReply(loaded) || !loaded.me) return false;
		try {
			await deps.sendReply(userId, loaded.invitation, loaded.me, response);
			return true;
		} catch (error) {
			console.error('Could not send invitation reply', error);
			return false;
		}
	}

	function allowed(loaded: Loaded, action: InvitationAction): boolean {
		if (loaded.invitation.method === 'CANCEL') return action === 'remove';
		return isResponse(action) ? canReply(loaded) : true;
	}

	return {
		async inspect(userId, emailId) {
			const loaded = await load(userId, emailId);
			return loaded ? view(userId, loaded) : null;
		},

		async act(userId, emailId, action) {
			const loaded = await load(userId, emailId);
			if (!loaded) return { type: 'not_found' };
			if (!allowed(loaded, action)) return { type: 'unsupported' };

			const { invitation } = loaded;
			const stored = await repo.get(userId, invitation.uid);
			if (isOutdated(invitation, stored)) return { type: 'outdated' };

			if (action === 'add' || action === 'accepted' || action === 'tentative') await place(userId, loaded);
			else await takeOff(userId, invitation);

			await record(userId, invitation, stored, isResponse(action) ? action : (stored?.response ?? null));
			const replied = isResponse(action) ? await reply(userId, loaded, action) : false;
			return { type: 'ok', view: await view(userId, loaded), replied };
		},

		async applyArrival(userId, ics) {
			const parsed = await parse(userId, ics);
			if (!parsed || parsed.invitation.method === 'PUBLISH') return 'ignored';
			const { invitation, zone } = parsed;
			const stored = await repo.get(userId, invitation.uid);
			if (!stored || isOutdated(invitation, stored)) return 'ignored';

			if (invitation.method === 'CANCEL') {
				await takeOff(userId, invitation);
			} else {
				// Declined, or taken off by hand: an update doesn't put it back.
				const wanted = isGoing(stored.response) || (await repo.hasEvents(userId, invitation.uid));
				if (!wanted) return 'ignored';
				await place(userId, { invitation, ics, zone });
			}
			await record(userId, invitation, stored, stored.response);
			return 'applied';
		}
	};
}
