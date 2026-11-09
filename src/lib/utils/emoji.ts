export const EMOJI_CATEGORIES = [
	'smileys',
	'people',
	'nature',
	'food',
	'activities',
	'travel',
	'objects',
	'symbols',
	'flags'
] as const;

export type EmojiCategory = (typeof EMOJI_CATEGORIES)[number];

/** Emojibase group number → our category. Group 2 is skin-tone components, which aren't emoji on their own. */
const GROUP_CATEGORY: Record<number, EmojiCategory> = {
	0: 'smileys',
	1: 'people',
	3: 'nature',
	4: 'food',
	5: 'travel',
	6: 'activities',
	7: 'objects',
	8: 'symbols',
	9: 'flags'
};

/** Every device in use draws these; only newer versions are checked. */
export const BASELINE_EMOJI_VERSION = 13;

/** One emoji as shipped to the browser: character, index into EMOJI_CATEGORIES, Unicode version, name words, other search words. */
export type EmojiRow = [char: string, category: number, version: number, name: string, tags: string];

export type EmojiData = {
	rows: EmojiRow[];
	/** One single-character emoji per version newer than the baseline, newest first, to test what the device draws. */
	probes: [version: number, char: string][];
};

/** The parts of an emojibase-data `compact.json` entry that are used. */
export type EmojibaseEntry = {
	unicode: string;
	hexcode: string;
	label: string;
	group?: number;
	order?: number;
	tags?: string[];
};

function wordsOf(...texts: (string | undefined)[]): string[] {
	return texts.join(' ').toLowerCase().split(/[\s:,]+/).filter(Boolean);
}

/**
 * Trims emojibase-data down to what the picker needs, at build time.
 * `english` adds English search words to another language's, so "pizza" works everywhere.
 */
export function buildEmojiData(
	local: EmojibaseEntry[],
	english: EmojibaseEntry[] | null,
	versions: Record<string, string[]>
): EmojiData {
	const versionOf = new Map<string, number>();
	for (const [version, hexcodes] of Object.entries(versions)) {
		for (const hexcode of hexcodes) versionOf.set(hexcode, Number(version));
	}
	const englishOf = new Map(english?.map((entry) => [entry.hexcode, entry]));

	const entries = local
		.filter((entry) => entry.group !== undefined && GROUP_CATEGORY[entry.group])
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

	const rows: EmojiRow[] = entries.map((entry) => {
		const category = EMOJI_CATEGORIES.indexOf(GROUP_CATEGORY[entry.group as number]);
		const other = englishOf.get(entry.hexcode);
		const name = new Set(wordsOf(entry.label, other?.label));
		const tags = new Set(wordsOf(...(entry.tags ?? []), ...(other?.tags ?? [])).filter((word) => !name.has(word)));
		return [entry.unicode, category, versionOf.get(entry.hexcode) ?? 0, [...name].join(' '), [...tags].join(' ')];
	});

	const probes = new Map<number, string>();
	for (const entry of entries) {
		const version = versionOf.get(entry.hexcode) ?? 0;
		if (version > BASELINE_EMOJI_VERSION && !entry.hexcode.includes('-') && !probes.has(version)) {
			probes.set(version, entry.unicode);
		}
	}
	return { rows, probes: [...probes].sort(([a], [b]) => b - a) };
}

/** The newest version whose test emoji the device draws. */
export function newestSupportedVersion(probes: EmojiData['probes'], draws: (char: string) => boolean): number {
	return probes.find(([, char]) => draws(char))?.[0] ?? BASELINE_EMOJI_VERSION;
}

export type Emoji = { char: string; category: EmojiCategory; name: string[]; words: string[] };

export function emojiUpTo(data: EmojiData, maxVersion: number): Emoji[] {
	return data.rows
		.filter(([, , version]) => version <= maxVersion)
		.map(([char, category, , name, tags]) => {
			const nameWords = name.split(' ');
			const words = tags ? [...nameWords, ...tags.split(' ')] : nameWords;
			return { char, category: EMOJI_CATEGORIES[category], name: nameWords, words };
		});
}

/**
 * Emoji whose search words start with every word typed, so "thu up" finds 👍.
 * Ones whose name matches come first, so "pizza" puts 🍕 ahead of emoji only tagged with it.
 * `anywhere` matches inside words too, for languages written without spaces.
 */
export function searchEmoji(emoji: Emoji[], query: string, anywhere = false): Emoji[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [];
	const matches = (word: string, term: string) => (anywhere ? word.includes(term) : word.startsWith(term));
	const matchesAll = (words: string[]) => terms.every((term) => words.some((word) => matches(word, term)));
	const found = emoji.filter((item) => matchesAll(item.words));
	return [...found.filter((item) => matchesAll(item.name)), ...found.filter((item) => !matchesAll(item.name))];
}

export const RECENT_EMOJI_LIMIT = 24;

/** The recent list after picking `char`: it moves to the front, without repeats, capped. */
export function rememberEmoji(recent: readonly string[], char: string): string[] {
	return [char, ...recent.filter((item) => item !== char)].slice(0, RECENT_EMOJI_LIMIT);
}

/** Emojibase has no Indonesian; those users search in English. */
export const EMOJI_LOCALES = { en: 'en', id: 'en', fr: 'fr', es: 'es', 'zh-CN': 'zh' } as const;

export type EmojiDataLocale = (typeof EMOJI_LOCALES)[keyof typeof EMOJI_LOCALES];
