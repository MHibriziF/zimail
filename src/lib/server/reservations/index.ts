import { APP_NAME } from '$lib/constants';
import { createD1CalendarRepository } from '../calendar/repository';
import { getEmailProvider } from '../context';
import { listAddressesForUser } from '../domains';
import { getMeetingsService } from '../meet/meetings';
import { renderEmailHtml, renderEmailText } from '../outbound/email-template';
import { sendOutboundEmail } from '../outbound/send-mail';
import { bookingEmailContent, bookingIcs, inviteContentType, type BookingDetails, type InviteKind } from './email';
import { createD1ReservationsRepository } from './repository';
import { createReservationsService, type MeetingRooms, type ReservationsService } from './service';

export { createReservationsService, type ReservationsService } from './service';

/** Meeting rooms need LiveKit; without it the option is offered but greyed out. */
export function meetingsConfigured(platform: App.Platform | undefined | null): boolean {
	const env = platform?.env;
	return Boolean(env?.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL);
}

function meetingRooms(platform: App.Platform | undefined | null): MeetingRooms | null {
	if (!meetingsConfigured(platform)) return null;
	const meetings = getMeetingsService(platform);
	return {
		async open(userId, title) {
			return (await meetings.create(userId, { title })).code;
		},
		async close(userId, code) {
			const meeting = await meetings.findByCode(code);
			if (meeting?.user_id === userId) await meetings.remove(userId, meeting.id);
		}
	};
}

/** Where join links point: the configured public URL, else the address the request came in on. */
export function publicBaseUrl(platform: App.Platform | undefined | null, requestOrigin: string): string {
	return platform?.env.APP_URL?.trim() || requestOrigin;
}

function utf8Base64(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCodePoint(byte);
	return btoa(binary);
}

/** Composition root for routes — mirrors `getCalendarService`. */
export function getReservationsService(platform: App.Platform | undefined | null): ReservationsService {
	const db = platform?.env.DB;
	if (!db) throw new Error('Database unavailable');

	const host = async (userId: string) => {
		const [user, addresses] = await Promise.all([
			db.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>(),
			listAddressesForUser(db, userId)
		]);
		const address = addresses.find((entry) => entry.is_default) ?? addresses[0];
		return address ? { address, name: address.label?.trim() || user?.name || APP_NAME } : null;
	};

	return createReservationsService({
		repo: createD1ReservationsRepository(db),
		calendar: createD1CalendarRepository(db),
		meetings: meetingRooms(platform),
		async hostOf(userId) {
			const found = await host(userId);
			return found ? { name: found.name, email: found.address.address } : null;
		},
		// Sent from the host's own address, with the host on Bcc so the booking also lands in their inbox.
		async notify(hostUserId: string, booking: BookingDetails, kind: InviteKind) {
			const found = await host(hostUserId);
			if (!found) return;
			const content = bookingEmailContent(booking, kind);
			await sendOutboundEmail(getEmailProvider(platform), {
				from: found.address,
				senderName: found.name,
				to: booking.guestEmail,
				bcc: found.address.address,
				subject: content.title,
				text: renderEmailText(content),
				html: renderEmailHtml(content),
				attachments: [
					{ filename: 'invite.ics', type: inviteContentType(kind), content: utf8Base64(bookingIcs(booking, kind)) }
				]
			});
		}
	});
}
