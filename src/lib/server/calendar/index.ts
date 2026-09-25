import type { D1Database } from '@cloudflare/workers-types';
import { getEmailProvider } from '../context';
import type { EmailProvider } from '../email-provider';
import { renderEmailHtml, renderEmailText } from '../outbound/email-template';
import { calendarAttachment, defaultSender, userTimeZone } from '../outbound/calendar-mail';
import { sendOutboundEmail } from '../outbound/send-mail';
import { ownEventUid } from '../invitations/answers';
import { getReservationsService } from '../reservations';
import { inviteEmailContent, inviteIcs, inviteMethod, type EventInvite } from './email';
import { createD1CalendarRepository } from './repository';
import { createCalendarService, type CalendarService, type GuestMail } from './service';

export type { CalendarRepository, NewCalendarEvent } from './repository';
export { createD1CalendarRepository } from './repository';
export { createCalendarService, type CalendarService, type CalendarWriteOutcome } from './service';

type PlatformLike = App.Platform | undefined | null;

/** One email per guest, from the user's default address, so one failed delivery doesn't stop the rest. */
async function emailGuests(db: D1Database, provider: EmailProvider, userId: string, mail: GuestMail) {
	const sender = await defaultSender(db, userId);
	if (!sender) return;
	const { event } = mail;
	const invite: EventInvite = {
		uid: ownEventUid(event.id),
		sequence: event.sequence,
		title: event.title,
		start: new Date(event.start),
		end: new Date(event.end),
		allDay: event.allDay,
		location: event.location,
		notes: event.notes,
		organizer: { email: sender.address.address.toLowerCase(), name: sender.name },
		guests: mail.attendees,
		timeZone: await userTimeZone(db, userId)
	};
	const content = inviteEmailContent(invite, mail.notice);
	const attachment = calendarAttachment(inviteIcs(invite, mail.notice), inviteMethod(mail.notice));
	const sent = await Promise.allSettled(
		mail.to.map((to) =>
			sendOutboundEmail(provider, {
				from: sender.address,
				senderName: sender.name,
				to,
				subject: content.title,
				text: renderEmailText(content),
				html: renderEmailHtml(content),
				attachments: [attachment]
			})
		)
	);
	const failed = sent.filter((result) => result.status === 'rejected');
	if (failed.length > 0) console.error(`Could not email ${failed.length} event guest(s)`, failed[0].reason);
}

/** Without `provider`, guest lists are kept but nobody is emailed. */
export function calendarServiceFor(
	db: D1Database,
	provider?: () => EmailProvider,
	cancelReservation?: (userId: string, id: string) => Promise<boolean>
): CalendarService {
	return createCalendarService({
		repo: createD1CalendarRepository(db),
		cancelReservation,
		notifyGuests: provider ? (userId, mail) => emailGuests(db, provider(), userId, mail) : undefined
	});
}

/** Composition root for routes — mirrors `getLabelsService`. */
export function getCalendarService(platform: PlatformLike): CalendarService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return calendarServiceFor(
		db,
		() => getEmailProvider(platform),
		(userId, id) => getReservationsService(platform).cancelBooking(userId, id)
	);
}
