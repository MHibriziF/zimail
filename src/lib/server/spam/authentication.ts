/**
 * Reads the verdicts a receiving server already stamped into
 * `Authentication-Results` (RFC 8601) — the free signal we lean on instead of
 * a paid classifier.
 *
 * Spam when DMARC fails, or when *both* SPF and DKIM fail: either one alone is
 * common for legitimate forwarded or mailing-list mail. A method only counts as
 * failed when some result failed and none passed — a message routinely carries
 * several DKIM signatures, or results from an ARC hop as well as the final
 * server, and one broken signature beside a good one isn't a forgery. A missing
 * header, or results we can't read, is never treated as spam.
 */
export function authenticationFailed(...headers: (string | null | undefined)[]): boolean {
	const results = headers.filter((header): header is string => Boolean(header)).join(';').toLowerCase();
	if (!results) return false;

	const failed = (method: string): boolean => {
		const verdicts = [...results.matchAll(new RegExp(String.raw`(?:^|[\s;])${method}=([a-z]+)`, 'g'))].map(
			(match) => match[1]
		);
		return verdicts.includes('fail') && !verdicts.includes('pass');
	};

	return failed('dmarc') || (failed('spf') && failed('dkim'));
}
