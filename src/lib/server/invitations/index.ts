import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { APP_NAME } from '$lib/constants';
import { isCalendarAttachment } from '../../utils/attachments';
import { getAttachmentForUser, listAttachments, readAttachmentBytes } from '../attachments';
import { getEmailProvider } from '../context';
import { listAddressesForUser } from '../domains';
import type { EmailProvider } from '../email-provider';
import { renderEmailHtml, renderEmailText } from '../outbound/email-template';
import { sendOutboundEmail } from '../outbound/send-mail';
import { replyEmailContent, replyIcs, replySubject } from './email';
import { createD1InvitationsRepository } from './repository';
import { createInvitationsService, type InvitationsService } from './service';

export { createInvitationsService, type InvitationsService, type InvitationView } from './service';
export { createD1InvitationsRepository, type InvitationsRepository } from './repository';

/** An invitation is a few KB; anything far bigger isn't worth parsing on a request. */
const MAX_CALENDAR_BYTES = 512 * 1024;

function utf8Base64(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCodePoint(byte);
	return btoa(binary);
}

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
		async timeZone(userId) {
			const row = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string | null }>();
			return row?.timezone || 'UTC';
		},
		async sendReply(userId, invitation, attendee, response) {
			if (!provider || !invitation.organizer) return;
			const addresses = await listAddressesForUser(db, userId);
			const from = addresses.find((address) => address.address.toLowerCase() === attendee.email);
			if (!from) return;
			const user = await db.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>();
			const content = replyEmailContent(invitation, attendee, response);
			await sendOutboundEmail(provider(), {
				from,
				senderName: from.label?.trim() || user?.name || APP_NAME,
				to: invitation.organizer.email,
				subject: replySubject(invitation, response),
				text: renderEmailText(content),
				html: renderEmailHtml(content),
				attachments: [
					{
						filename: 'invite.ics',
						type: 'text/calendar; method=REPLY; charset=UTF-8',
						content: utf8Base64(replyIcs(invitation, attendee, response))
					}
				]
			});
		}
	});
}

/** Narrows a stored attachment to one whose bytes were kept. */
export function hasBytes<T extends { bytes?: Uint8Array }>(attachment: T): attachment is T & { bytes: Uint8Array } {
	return attachment.bytes !== undefined;
}

/**
 * For the inbound paths: an organizer's update or cancellation is applied as
 * it arrives. Never throws — the message is already stored.
 */
export async function applyArrivedInvitation(
	db: D1Database,
	userId: string,
	attachments: { contentType: string; filename: string; bytes: Uint8Array }[]
): Promise<void> {
	const part = pickCalendarPart(attachments.map((attachment) => ({ ...attachment, size: attachment.bytes.byteLength })));
	if (!part) return;
	try {
		await invitationsServiceFor(db, undefined).applyArrival(userId, new TextDecoder().decode(part.bytes));
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
