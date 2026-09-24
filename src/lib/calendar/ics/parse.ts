/**
 * Just enough of RFC 5545 to read a published calendar: unfold lines, split
 * each into name/params/value, and collect the VEVENT components. Everything
 * else (VTODO, VALARM, VTIMEZONE bodies) is skipped.
 */

export type IcsProperty = { name: string; params: Record<string, string>; value: string };

/** One VEVENT, properties by upper-case name — repeated ones (EXDATE) keep every instance. */
export type IcsComponent = Map<string, IcsProperty[]>;

export type IcsCalendar = {
	events: IcsComponent[];
	/** `X-WR-TIMEZONE`, which Google sets and floating times are read in. */
	timeZone: string | null;
};

function unfold(text: string): string[] {
	return text.replaceAll(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

/** Splits at the first `:` outside a quoted parameter value. */
function splitValue(line: string): [string, string] | null {
	let quoted = false;
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		if (char === '"') quoted = !quoted;
		else if (char === ':' && !quoted) return [line.slice(0, index), line.slice(index + 1)];
	}
	return null;
}

export function parseProperty(line: string): IcsProperty | null {
	const split = splitValue(line);
	if (!split) return null;
	const [head, value] = split;
	const [name, ...rawParams] = head.split(';');
	const params: Record<string, string> = {};
	for (const param of rawParams) {
		const eq = param.indexOf('=');
		if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replaceAll('"', '');
	}
	return { name: name.toUpperCase(), params, value };
}

/** TEXT values escape `,` `;` `\` and newlines with a backslash. */
export function unescapeText(value: string): string {
	return value.replaceAll(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

export function parseIcs(text: string): IcsCalendar {
	const events: IcsComponent[] = [];
	let timeZone: string | null = null;
	let current: IcsComponent | null = null;
	// Depth inside the current VEVENT, so a nested VALARM's properties are ignored.
	let nested = 0;

	for (const line of unfold(text)) {
		const property = parseProperty(line);
		if (!property) continue;
		const { name, value } = property;
		const kind = value.trim().toUpperCase();

		if (name === 'BEGIN') {
			if (current) nested++;
			else if (kind === 'VEVENT') current = new Map();
		} else if (name === 'END') {
			if (current && nested > 0) nested--;
			else if (current && kind === 'VEVENT') {
				events.push(current);
				current = null;
			}
		} else if (current && nested === 0) {
			const list = current.get(name);
			if (list) list.push(property);
			else current.set(name, [property]);
		} else if (!current && name === 'X-WR-TIMEZONE') {
			timeZone = value.trim();
		}
	}
	return { events, timeZone };
}

export function first(component: IcsComponent, name: string): IcsProperty | undefined {
	return component.get(name)?.[0];
}
