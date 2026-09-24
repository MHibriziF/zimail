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

/** Splits on `separator` wherever it isn't inside a quoted parameter value; `limit` caps the pieces. */
function splitOutsideQuotes(text: string, separator: string, limit = Infinity): string[] {
	const parts: string[] = [];
	let start = 0;
	let quoted = false;
	for (let index = 0; index < text.length && parts.length < limit - 1; index++) {
		const char = text[index];
		if (char === '"') quoted = !quoted;
		else if (char === separator && !quoted) {
			parts.push(text.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}

export function parseProperty(line: string): IcsProperty | null {
	const split = splitOutsideQuotes(line, ':', 2);
	if (split.length < 2) return null;
	const [head, value] = split;
	// `CN="Doe; Jane"` is one parameter, not two.
	const [name, ...rawParams] = splitOutsideQuotes(head, ';');
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

/** Walks lines into VEVENTs. `depth` counts components opened inside the current event (VALARM). */
class Collector {
	events: IcsComponent[] = [];
	timeZone: string | null = null;
	private current: IcsComponent | null = null;
	private depth = 0;

	begin(kind: string) {
		if (this.current) this.depth++;
		else if (kind === 'VEVENT') this.current = new Map();
	}

	end(kind: string) {
		if (!this.current) return;
		if (this.depth > 0) this.depth--;
		else if (kind === 'VEVENT') {
			this.events.push(this.current);
			this.current = null;
		}
	}

	property(property: IcsProperty) {
		if (!this.current) {
			if (property.name === 'X-WR-TIMEZONE') this.timeZone = property.value.trim();
			return;
		}
		if (this.depth > 0) return;
		const list = this.current.get(property.name);
		if (list) list.push(property);
		else this.current.set(property.name, [property]);
	}
}

export function parseIcs(text: string): IcsCalendar {
	const collector = new Collector();
	for (const line of unfold(text)) {
		const property = parseProperty(line);
		if (!property) continue;
		const kind = property.value.trim().toUpperCase();
		if (property.name === 'BEGIN') collector.begin(kind);
		else if (property.name === 'END') collector.end(kind);
		else collector.property(property);
	}
	return { events: collector.events, timeZone: collector.timeZone };
}

export function first(component: IcsComponent, name: string): IcsProperty | undefined {
	return component.get(name)?.[0];
}
