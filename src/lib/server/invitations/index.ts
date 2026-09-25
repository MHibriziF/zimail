import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { isCalendarAttachment } from '../../utils/attachments';
import { getAttachmentForUser, listAttachments, readAttachmentBytes } from '../attachments';
import { getCalendarService } from '../calendar';
import { createD1CalendarRepository } from '../calendar/repository';
import { getEmailProvider } from '../context';
import { listAddressesForUser } from '../domains';
import type { EmailProvider } from '../email-provider';
import { renderEmailHtml, renderEmailText, type EmailContent } from '../outbound/email-template';
import { calendarAttachment, senderFor, userTimeZone } from '../outbound/calendar-mail';
import { sendOutboundEmail } from '../outbound/send-mail';
import { getReservationsService } from '../reservations';
import type { InviteParty } from '../../calendar/ics/invite';
import { createAnswersService, type AnswersService } from './answers';
import {
	declineCounterEmailContent,
	declineCounterIcs,
	replyEmailContent,
	replyIcs,
	replySubject
} from './email';
import { createD1InvitationsRepository } from './repository';
import { createInvitationsService, type InvitationsService } from './service';

export { createInvitationsService, type InvitationsService, type InvitationView } from './service';
export { createAnswersService, type AnswersService } from './answers';
export { createD1InvitationsRepository, type InvitationsRepository } from './repository';

/** An invitation is a few KB; anything far bigger isn't worth parsing on a request. */
const MAX_CALENDAR_BYTES = 512 * 1024;
/** Events looked at around a proposed time — a few days' worth of anyone's calendar. */
const MAX_NEARBY_EVENTS = 500;

type Part = { contentType: string; filename: string; size: number };

/** The part to read: `text/calendar` first, since it carries METHOD where a bare `invite.ics` sometimes doesn't. */
function pickCalendarPart<T extends Part>(parts: T[]): T | undefined {
	const isText = (part: Part) => Number(part.contentType.toLowerCase().startsWith('text/calendar'));
	return parts
		.filter((part) => isCalendarAttachment(part.contentType, part.filename) && part.size <= MAX_CALENDAR_BYTES)
		.sort((a, b) => isText(b) - isText(a))[0];
}

async function loadCalendarPart(db: D1Database, bucket: R2Bucket | undefined, userId: string, emailId: string) {
	if (!bucket) return null;
	const chosen = pickCalendarPart(
		(await listAttachments(db, emailId)).map((part) => ({
			id: part.id,
			contentType: part.content_type,
			filename: part.filename,
			size: part.size_bytes
		}))
	);
	const part = chosen ? await getAttachmentForUser(db, userId, emailId, chosen.id) : null;
	const bytes = part ? await readAttachmentBytes(bucket, part) : null;
	return bytes ? new TextDecoder().decode(bytes) : null;
}

type CalendarMail = {
	/** Which of the user's addresses to send from; the default one when it isn't theirs or isn't given. */
	fromEmail: string | null;
	/** Only this exact address will do — an answer must come from the address that was invited. */
	strict?: boolean;
	to: string;
	subject: string;
	content: EmailContent;
	method: string;
	/** Built once the sending address is known, since the file names it. */
	ics: (from: InviteParty) => string;
};

/** A calendar message (a reply, a declined proposal) sent from one of the user's own addresses. */
async function sendCalendarMail(db: D1Database, provider: EmailProvider, userId: string, mail: CalendarMail) {
	const addresses = await listAddressesForUser(db, userId);
	const exact = addresses.find((address) => address.address.toLowerCase() === mail.fromEmail?.toLowerCase());
	const from = mail.strict ? exact : (exact ?? addresses.find((address) => address.is_default) ?? addresses[0]);
	if (!from) return;
	const sender = await senderFor(db, userId, from);
	const ics = mail.ics({ email: from.address.toLowerCase(), name: sender.name });
	await sendOutboundEmail(provider, {
		from,
		senderName: sender.name,
		to: mail.to,
		subject: mail.subject,
		text: renderEmailText(mail.content),
		html: renderEmailHtml(mail.content),
		attachments: [calendarAttachment(ics, mail.method)]
	});
}

/** `provider` is only needed to answer; the inbound paths, which just apply updates, go without. */
export function invitationsServiceFor(
	db: D1Database,
	bucket: R2Bucket | undefined,
	provider?: () => EmailProvider
): InvitationsService {
	return createInvitationsService({
		repo: createD1InvitationsRepository(db),
		loadCalendarPart: (userId, emailId) => loadCalendarPart(db, bucket, userId, emailId),
		ownAddresses: async (userId) => (await listAddressesForUser(db, userId)).map((address) => address.address),
		timeZone: (userId) => userTimeZone(db, userId),
		async sendReply(userId, invitation, attendee, response) {
			if (!provider || !invitation.organizer) return;
			await sendCalendarMail(db, provider(), userId, {
				fromEmail: attendee.email,
				strict: true,
				to: invitation.organizer.email,
				subject: replySubject(invitation, response),
				content: replyEmailContent(invitation, attendee, response),
				method: 'REPLY',
				ics: () => replyIcs(invitation, attendee, response)
			});
		}
	});
}

type AnswerActions = Pick<Parameters<typeof createAnswersService>[0], 'reschedule' | 'declineProposal'>;

/** Without `actions`, answers can be read and replies recorded, but proposals not acted on. */
export function answersServiceFor(db: D1Database, bucket: R2Bucket | undefined, actions?: AnswerActions): AnswersService {
	return createAnswersService({
		repo: createD1InvitationsRepository(db),
		loadCalendarPart: (userId, emailId) => loadCalendarPart(db, bucket, userId, emailId),
		timeZone: (userId) => userTimeZone(db, userId),
		reschedule: actions?.reschedule ?? (async () => 'not_found'),
		declineProposal: actions?.declineProposal ?? (async () => undefined),
		eventsBetween: (userId, from, to) =>
			createD1CalendarRepository(db).listOverlapping(userId, from.toISOString(), to.toISOString(), MAX_NEARBY_EVENTS)
	});
}

/** Narrows a stored attachment to one whose bytes were kept. */
export function hasBytes<T extends { bytes?: Uint8Array }>(attachment: T): attachment is T & { bytes: Uint8Array } {
	return attachment.bytes !== undefined;
}

/**
 * For the inbound paths: an organizer's update or cancellation, or a guest's
 * answer to the user's own invitation, is applied as it arrives. Never throws
 * — the message is already stored.
 */
export async function applyArrivedInvitation(
	db: D1Database,
	userId: string,
	attachments: { contentType: string; filename: string; bytes: Uint8Array }[]
): Promise<void> {
	const part = pickCalendarPart(attachments.map((attachment) => ({ ...attachment, size: attachment.bytes.byteLength })));
	if (!part) return;
	const ics = new TextDecoder().decode(part.bytes);
	try {
		if ((await answersServiceFor(db, undefined).applyArrival(userId, ics)) === 'ignored') {
			await invitationsServiceFor(db, undefined).applyArrival(userId, ics);
		}
	} catch (error) {
		console.error('Could not apply an arriving invitation', error);
	}
}

/** Composition root for routes. */
export function getInvitationsService(platform: App.Platform | undefined | null): InvitationsService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return invitationsServiceFor(db, platform?.env.ATTACHMENTS, () => getEmailProvider(platform));
}

/** Composition root for routes: answers to the user's own invitations, and acting on proposed times. `requestOrigin` is for meeting links. */
export function getAnswersService(platform: App.Platform | undefined | null, requestOrigin = ''): AnswersService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return answersServiceFor(db, platform?.env.ATTACHMENTS, {
		async reschedule(userId, event, start, end) {
			if (event.source === 'manual') return getCalendarService(platform, requestOrigin).reschedule(userId, event.id, start, end);
			return getReservationsService(platform).rescheduleBooking(userId, event.id, start, end);
		},
		async declineProposal(userId, event, proposal, guest) {
			await sendCalendarMail(db, getEmailProvider(platform), userId, {
				fromEmail: proposal.organizer?.email ?? null,
				to: guest.email,
				subject: `New time declined: ${event.title}`.slice(0, 200),
				content: declineCounterEmailContent(event.title, proposal.organizer?.name ?? 'The organizer'),
				method: 'DECLINECOUNTER',
				ics: (from) => declineCounterIcs(proposal, from, guest, {
					start: new Date(event.start),
					end: new Date(event.end),
					sequence: event.sequence
				})
			});
		}
	});
}
