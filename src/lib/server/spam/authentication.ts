/**
 * Reads the verdicts a receiving server already stamped into
 * `Authentication-Results` (RFC 8601) — the free signal we lean on instead of
 * a paid classifier.
 *
 * Spam when DMARC explicitly fails, or when *both* SPF and DKIM fail: either
 * one alone is common for legitimate forwarded or mailing-list mail, so it
 * isn't enough on its own. A missing header, or results we can't read, is
 * never treated as spam.
 */
export function authenticationFailed(...headers: (string | null | undefined)[]): boolean {
	const results = headers.filter((header): header is string => Boolean(header)).join(';').toLowerCase();
	if (!results) return false;

	const verdict = (method: string): string | null =>
		new RegExp(String.raw`(?:^|[\s;])${method}=([a-z]+)`).exec(results)?.[1] ?? null;

	if (verdict('dmarc') === 'fail') return true;
	return verdict('spf') === 'fail' && verdict('dkim') === 'fail';
}
