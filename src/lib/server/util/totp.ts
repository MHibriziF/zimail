import { trimTrailing } from '../../utils/text';

/**
 * TOTP (RFC 6238) on WebCrypto — no dependency needed.
 *
 * SHA-1, 6 digits and a 30-second step are not choices so much as what every
 * authenticator app assumes; Google Authenticator ignores the algorithm and
 * digits parameters in an otpauth URI entirely, so deviating would produce
 * codes that silently never match.
 */

const DIGITS = 6;
const PERIOD_SECONDS = 30;
/** Secret length recommended by RFC 4226 §4 for HMAC-SHA1. */
const SECRET_BYTES = 20;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = '';

	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}

	if (bits > 0) {
		output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	}

	return output;
}

export function decodeBase32(secret: string): Uint8Array {
	// Authenticator apps show the secret in spaced groups, and users paste it back
	// that way. Padding is optional in otpauth URIs.
	const clean = trimTrailing(secret.replace(/[\s-]/g, ''), '=').toUpperCase();

	let bits = 0;
	let value = 0;
	const bytes: number[] = [];

	for (const char of clean) {
		const index = BASE32_ALPHABET.indexOf(char);
		if (index === -1) {
			throw new Error('Secret is not valid base32');
		}
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}

	return new Uint8Array(bytes);
}

export function generateTotpSecret(): string {
	return encodeBase32(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

/** The 8-byte big-endian counter RFC 4226 signs. */
function counterBytes(counter: number): Uint8Array {
	const bytes = new Uint8Array(8);
	// Split rather than use BigInt shifts: counters stay well inside 2^53.
	let high = Math.floor(counter / 0x100000000);
	let low = counter >>> 0;

	for (let i = 7; i >= 4; i--) {
		bytes[i] = low & 0xff;
		low = low >>> 8;
	}
	for (let i = 3; i >= 0; i--) {
		bytes[i] = high & 0xff;
		high = Math.floor(high / 256);
	}

	return bytes;
}

async function hotp(secretBytes: Uint8Array, counter: number): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		secretBytes as BufferSource,
		{ name: 'HMAC', hash: 'SHA-1' },
		false,
		['sign']
	);

	const mac = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, counterBytes(counter) as BufferSource)
	);

	// Dynamic truncation, RFC 4226 §5.4.
	const offset = mac[mac.length - 1] & 0x0f;
	const binary =
		((mac[offset] & 0x7f) << 24) |
		((mac[offset + 1] & 0xff) << 16) |
		((mac[offset + 2] & 0xff) << 8) |
		(mac[offset + 3] & 0xff);

	return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export async function totpCode(secret: string, atMs = Date.now()): Promise<string> {
	const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
	return hotp(decodeBase32(secret), counter);
}

type TotpOptions = { window?: number; atMs?: number };

/**
 * The time step `code` belongs to, or null when it matches none.
 *
 * Accepts the neighbouring steps too, so a phone clock that drifts by a few
 * seconds still works. One step either side is the usual tolerance — wider
 * windows meaningfully weaken a 6-digit code. Callers that sign someone in
 * must refuse a step at or below the last one they accepted, or the same code
 * works again for the rest of the window.
 */
export async function matchTotpStep(
	secret: string,
	code: string,
	{ window = 1, atMs = Date.now() }: TotpOptions = {}
): Promise<number | null> {
	const cleaned = code.replace(/\s/g, '');
	if (!/^\d{6}$/.test(cleaned)) return null;

	let secretBytes: Uint8Array;
	try {
		secretBytes = decodeBase32(secret);
	} catch {
		return null;
	}

	const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
	let matched: number | null = null;

	// Every candidate is checked even after a hit, so the time taken does not
	// reveal which step matched.
	for (let offset = -window; offset <= window; offset++) {
		const candidate = await hotp(secretBytes, counter + offset);
		let diff = candidate.length ^ cleaned.length;
		for (let i = 0; i < candidate.length; i++) {
			diff |= candidate.charCodeAt(i) ^ cleaned.charCodeAt(i % cleaned.length);
		}
		if (diff === 0) matched = counter + offset;
	}

	return matched;
}

export async function verifyTotp(secret: string, code: string, options: TotpOptions = {}): Promise<boolean> {
	return (await matchTotpStep(secret, code, options)) !== null;
}

/** The URI an authenticator app scans. Label carries issuer twice by convention. */
export function otpauthUri(secret: string, account: string, issuer: string): string {
	const label = encodeURIComponent(`${issuer}:${account}`);
	const params = new URLSearchParams({
		secret,
		issuer,
		algorithm: 'SHA1',
		digits: String(DIGITS),
		period: String(PERIOD_SECONDS)
	});
	return `otpauth://totp/${label}?${params.toString()}`;
}

export { formatSecretForDisplay } from '$lib/totp-display';
