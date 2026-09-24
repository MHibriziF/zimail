import { APP_NAME } from '$lib/constants';
import { createD1CalendarRepository } from '../calendar/repository';
import { getEmailProvider } from '../context';
import { listAddressesForUser } from '../domains';
import { renderEmailHtml, renderEmailText } from '../outbound/email-template';
import { sendOutboundEmail } from '../outbound/send-mail';
import { bookingEmailContent, bookingIcs, inviteContentType, type BookingDetails, type InviteKind } from './email';
import { createD1ReservationsRepository } from './repository';
import { createReservationsService, type ReservationsService } from './service';

export { createReservationsService, type ReservationsService } from './service';

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
