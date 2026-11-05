import { createD1CalendarRepository } from '../calendar/repository';
import { calendarFeedsServiceForDb } from '../calendar-feeds';
import { getEmailProvider } from '../context';
import { getMeetingsService } from '../meet/meetings';
import { emailLogoAttachment, renderEmailHtml, renderEmailText } from '../outbound/email-template';
import { calendarAttachment, defaultSender } from '../outbound/calendar-mail';
import { sendOutboundEmail } from '../outbound/send-mail';
import {
	bookingEmailContent,
	bookingIcs,
	bookingMethod,
	bookingRecipients,
	bookingReminderContent,
	type BookingDetails,
	type InviteKind
} from './email';
import type { ReminderKind } from '../../calendar/reminders';
import { createD1ReservationsRepository } from './repository';
import { createReservationsService, type MeetingRooms, type ReservationsService } from './service';

export { createReservationsService, type ReservationsService } from './service';

/** Meeting rooms need LiveKit; without it the option is offered but greyed out. */
export function meetingsConfigured(platform: App.Platform | undefined | null): boolean {
	const env = platform?.env;
	return Boolean(env?.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL);
}

export function meetingRooms(platform: App.Platform | undefined | null): MeetingRooms | null {
	if (!meetingsConfigured(platform)) return null;
	const meetings = getMeetingsService(platform);
	const owned = async (userId: string, code: string) => {
		const meeting = await meetings.findByCode(code);
		return meeting?.user_id === userId ? meeting : null;
	};
	return {
		async open(userId, title, settings, schedule) {
			return (await meetings.create(userId, { title, ...settings, schedule })).code;
		},
		async reschedule(userId, code, schedule) {
			const meeting = await owned(userId, code);
			if (meeting) await meetings.setSchedule(userId, meeting.id, schedule);
		},
		async close(userId, code) {
			const meeting = await owned(userId, code);
			if (meeting) await meetings.remove(userId, meeting.id);
		},
		async settingsOf(userId, code) {
			const meeting = await owned(userId, code);
			return meeting
				? {
						requireApproval: meeting.require_approval,
						waitForHost: meeting.wait_for_host,
						screenSharePolicy: meeting.screen_share_policy,
						screenShareMode: meeting.screen_share_mode
					}
				: null;
		},
		async configure(userId, code, settings) {
			const meeting = await owned(userId, code);
			if (meeting) await meetings.update(userId, meeting.id, settings);
		}
	};
}

/** Where join links point: the configured public URL, else the address the request came in on. */
export function publicBaseUrl(platform: App.Platform | undefined | null, requestOrigin: string): string {
	return platform?.env.APP_URL?.trim() || requestOrigin;
}

/** Composition root for routes — mirrors `getCalendarService`. */
export function getReservationsService(platform: App.Platform | undefined | null): ReservationsService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');

	return createReservationsService({
		repo: createD1ReservationsRepository(db),
		calendar: createD1CalendarRepository(db),
		meetings: meetingRooms(platform),
		refreshCalendars: (userId) => calendarFeedsServiceForDb(db).refreshStale(userId),
		defer: (work) => platform?.ctx?.waitUntil(work),
		async hostOf(userId) {
			const found = await defaultSender(db, userId);
			return found ? { name: found.name, email: found.address.address } : null;
		},
		// Sent from the host's own address, with the host on Bcc so the booking also lands in their inbox.
		async notify(hostUserId: string, booking: BookingDetails, kind: InviteKind) {
			const found = await defaultSender(db, hostUserId);
			if (!found) return;
			const content = bookingEmailContent(booking, kind);
			await sendOutboundEmail(getEmailProvider(platform), {
				from: found.address,
				senderName: found.name,
				to: bookingRecipients(booking),
				bcc: found.address.address,
				subject: content.title,
				text: renderEmailText(content),
				html: renderEmailHtml(content),
				attachments: [calendarAttachment(bookingIcs(booking, kind), bookingMethod(kind)), emailLogoAttachment()]
			});
		},
		// Same sender and recipients as the invitation, without a second copy to the host.
		async remind(hostUserId: string, booking: BookingDetails, kind: ReminderKind) {
			const found = await defaultSender(db, hostUserId);
			if (!found) return;
			const content = bookingReminderContent(booking, kind);
			await sendOutboundEmail(getEmailProvider(platform), {
				from: found.address,
				senderName: found.name,
				to: bookingRecipients(booking),
				subject: content.title,
				text: renderEmailText(content),
				html: renderEmailHtml(content),
				attachments: [emailLogoAttachment()]
			});
		}
	});
}

/** For the cron trigger: sends the booking reminders that are due. */
export function runDueBookingReminders(platform: App.Platform): Promise<{ sent: number; skipped: number }> {
	return getReservationsService(platform).sendDueReminders();
}
