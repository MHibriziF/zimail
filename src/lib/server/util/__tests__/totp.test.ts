import assert from 'node:assert/strict';
import test from 'node:test';
import {
	decodeBase32,
	encodeBase32,
	formatSecretForDisplay,
	generateTotpSecret,
	otpauthUri,
	totpCode,
	verifyTotp
} from '../totp';

/**
 * RFC 6238 publishes its vectors for a 20-byte ASCII seed, "12345678901234567890".
 * Base32 of that seed is the value below — the same one the RFC 4226 test suite
 * uses, so a mismatch here means the HMAC or the truncation is wrong.
 */
const RFC_SECRET = encodeBase32(new TextEncoder().encode('12345678901234567890'));

test('base32 round-trips arbitrary bytes', () => {
	const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
	assert.deepEqual([...decodeBase32(encodeBase32(bytes))], [...bytes]);
});

test('base32 encodes the RFC seed to the documented value', () => {
	assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('base32 decoding tolerates spacing, padding and lower case', () => {
	const expected = [...decodeBase32(RFC_SECRET)];
	assert.deepEqual([...decodeBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')], expected);
	assert.deepEqual([...decodeBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ======')], expected);
});

test('base32 decoding rejects characters outside the alphabet', () => {
	assert.throws(() => decodeBase32('NOT-BASE32!!1'), /not valid base32/i);
});

// RFC 6238 Appendix B, the SHA-1 rows, truncated to the 6 digits we emit.
test('produces the RFC 6238 reference codes', async () => {
	const vectors: Array<[number, string]> = [
		[59, '287082'],
		[1111111109, '081804'],
		[1111111111, '050471'],
		[1234567890, '005924'],
		[2000000000, '279037'],
		[20000000000, '353130']
	];

	for (const [seconds, expected] of vectors) {
		assert.equal(await totpCode(RFC_SECRET, seconds * 1000), expected, `at t=${seconds}`);
	}
});

test('verifies the code for the current step', async () => {
	const atMs = 1111111109 * 1000;
	assert.equal(await verifyTotp(RFC_SECRET, '081804', { atMs }), true);
});

test('tolerates one step of clock drift either way', async () => {
	const atMs = 1111111109 * 1000;
	// The code from the previous and next 30-second windows.
	const previous = await totpCode(RFC_SECRET, atMs - 30_000);
	const next = await totpCode(RFC_SECRET, atMs + 30_000);

	assert.equal(await verifyTotp(RFC_SECRET, previous, { atMs }), true);
	assert.equal(await verifyTotp(RFC_SECRET, next, { atMs }), true);
});

test('rejects a code two steps away', async () => {
	const atMs = 1111111109 * 1000;
	const stale = await totpCode(RFC_SECRET, atMs - 90_000);
	assert.equal(await verifyTotp(RFC_SECRET, stale, { atMs }), false);
});

test('rejects malformed input without throwing', async () => {
	const atMs = 1111111109 * 1000;
	assert.equal(await verifyTotp(RFC_SECRET, '', { atMs }), false);
	assert.equal(await verifyTotp(RFC_SECRET, '12345', { atMs }), false);
	assert.equal(await verifyTotp(RFC_SECRET, 'abcdef', { atMs }), false);
	assert.equal(await verifyTotp(RFC_SECRET, '0818040', { atMs }), false);
	assert.equal(await verifyTotp('not base32', '081804', { atMs }), false);
});

test('ignores spaces in a pasted code', async () => {
	const atMs = 1111111109 * 1000;
	assert.equal(await verifyTotp(RFC_SECRET, '081 804', { atMs }), true);
});

test('generates a distinct 32-character secret each time', () => {
	const a = generateTotpSecret();
	const b = generateTotpSecret();
	assert.equal(a.length, 32);
	assert.notEqual(a, b);
	assert.match(a, /^[A-Z2-7]+$/);
});

test('builds an otpauth URI an authenticator can parse', () => {
	const uri = otpauthUri(RFC_SECRET, 'you@example.com', 'Quickinbox');
	assert.ok(uri.startsWith('otpauth://totp/Quickinbox%3Ayou%40example.com?'));

	const params = new URL(uri).searchParams;
	assert.equal(params.get('secret'), RFC_SECRET);
	assert.equal(params.get('issuer'), 'Quickinbox');
	assert.equal(params.get('digits'), '6');
	assert.equal(params.get('period'), '30');
});

test('formats a secret in groups of four for manual entry', () => {
	assert.equal(formatSecretForDisplay('GEZDGNBVGY3TQOJQ'), 'GEZD GNBV GY3T QOJQ');
});
