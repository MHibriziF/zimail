import type { D1Database } from '@cloudflare/workers-types';
import { getEmailProvider } from '../context';
import type { EmailProvider } from '../email-provider';
import { renderEmailHtml, renderEmailText } from '../outbound/email-template';
import { calendarAttachment, defaultSender, userTimeZone } from '../outbound/calendar-mail';
import { sendOutboundEmail } from '../outbound/send-mail';
import { ownEventUid } from '../invitations/answers';
import { getReservationsService, meetingRooms, publicBaseUrl } from '../reservations';
import type { MeetingRooms } from '../reservations/service';
import { inviteEmailContent, inviteIcs, inviteMethod, type EventInvite } from './email';
import { createD1CalendarRepository } from './repository';
import { createCalendarService, type CalendarService, type GuestMail } from './service';

export type { CalendarRepository, NewCalendarEvent } from './repository';
export { createD1CalendarRepository } from './repository';
export { createCalendarService, type CalendarService, type CalendarWriteOutcome } from './service';

type PlatformLike = App.Platform | undefined | null;

export type CalendarServiceOptions = {
	/** Without it, guest lists are kept but nobody is emailed. */
	provider?: () => EmailProvider;
	cancelReservation?: (userId: string, id: string) => Promise<boolean>;
	meetings?: MeetingRooms | null;
	/** This deployment's origin, for meeting links; without it, invitations carry none. */
	baseUrl?: string;
};

function meetingUrl(code: string | null, baseUrl: string | undefined): string | null {
	return code && baseUrl ? new URL(`/meet/${code}`, baseUrl).href : null;
}

/** One email per guest, from the user's default address, so one failed delivery doesn't stop the rest. */
async function emailGuests(
	db: D1Database,
	provider: EmailProvider,
	baseUrl: string | undefined,
	userId: string,
	mail: GuestMail
) {
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
		meetingUrl: meetingUrl(event.meetingCode, baseUrl),
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

export function calendarServiceFor(db: D1Database, options: CalendarServiceOptions = {}): CalendarService {
	const { provider, baseUrl } = options;
	return createCalendarService({
		repo: createD1CalendarRepository(db),
		cancelReservation: options.cancelReservation,
		meetings: options.meetings,
		notifyGuests: provider ? (userId, mail) => emailGuests(db, provider(), baseUrl, userId, mail) : undefined
	});
}

/** Composition root for routes — mirrors `getLabelsService`. `requestOrigin` is for meeting links. */
export function getCalendarService(platform: PlatformLike, requestOrigin = ''): CalendarService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');
	return calendarServiceFor(db, {
		provider: () => getEmailProvider(platform),
		cancelReservation: (userId, id) => getReservationsService(platform).cancelBooking(userId, id),
		meetings: meetingRooms(platform),
		baseUrl: publicBaseUrl(platform, requestOrigin) || undefined
	});
}
