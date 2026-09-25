import type { D1Database } from '@cloudflare/workers-types';
import { APP_NAME } from '$lib/constants';
import type { MailAddress, OutboundAttachmentInput } from '$lib/types';
import { listAddressesForUser } from '../domains';

export type Sender = { address: MailAddress; name: string };

/** The name a message from `address` goes out under: its label, else the account's name. */
export async function senderFor(db: D1Database, userId: string, address: MailAddress): Promise<Sender> {
	const user = await db.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>();
	return { address, name: address.label?.trim() || user?.name || APP_NAME };
}

/** The user's default address, which invitations they organize are sent from. */
export async function defaultSender(db: D1Database, userId: string): Promise<Sender | null> {
	const addresses = await listAddressesForUser(db, userId);
	const address = addresses.find((entry) => entry.is_default) ?? addresses[0];
	return address ? senderFor(db, userId, address) : null;
}

export async function userTimeZone(db: D1Database, userId: string): Promise<string> {
	const row = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string | null }>();
	return row?.timezone || 'UTC';
}

function utf8Base64(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCodePoint(byte);
	return btoa(binary);
}

/** An iTIP file; mail clients read the method from the MIME type as well as from the file. */
export function calendarAttachment(ics: string, method: string): OutboundAttachmentInput {
	return { filename: 'invite.ics', type: `text/calendar; method=${method}; charset=UTF-8`, content: utf8Base64(ics) };
}
