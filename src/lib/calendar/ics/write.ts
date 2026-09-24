/**
 * Writing iCalendar: the escaping and folding RFC 5545 asks for, shared by
 * every invitation Zimail sends (bookings, event invitations, replies).
 */

/** TEXT values escape `\` `;` `,` and newlines with a backslash. */
export function icsText(value: string): string {
	return value
		.replaceAll('\\', String.raw`\\`)
		.replaceAll(';', String.raw`\;`)
		.replaceAll(',', String.raw`\,`)
		.replaceAll(/\r?\n/g, String.raw`\n`);
}

/** Parameter values (CN) can't be escaped, only quoted — so quotes themselves are dropped. */
export function icsParam(value: string): string {
	return `"${value.replaceAll('"', '')}"`;
}

/** A UTC DATE-TIME: `20260925T033000Z`. */
export function icsTime(date: Date): string {
	return `${date.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z`;
}

/** An all-day DATE from a floating UTC-midnight instant: `20260925`. */
export function icsDate(date: Date): string {
	return date.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Folds at 75 octets as RFC 5545 asks; long summaries would otherwise break strict parsers. */
function fold(line: string): string {
	const chunks: string[] = [];
	for (let index = 0; index < line.length; index += 73) chunks.push(line.slice(index, index + 73));
	return chunks.join('\r\n ');
}

/** Folds each line and joins them with the CRLFs the format requires, ending with one. */
export function icsDocument(lines: string[]): string {
	return [...lines, ''].map(fold).join('\r\n');
}

/** `ORGANIZER;CN="Ada":mailto:ada@example.com`, or without CN when there's no name. */
export function icsPerson(property: string, email: string, name: string | null, params: string[] = []): string {
	const cn = name ? [`CN=${icsParam(name)}`] : [];
	return [property, ...cn, ...params].join(';') + `:mailto:${email}`;
}
