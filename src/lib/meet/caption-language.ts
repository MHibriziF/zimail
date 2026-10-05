/**
 * Which languages a speaker's captions are in. Whisper guesses the language
 * afresh for every short segment, and on a word or two it guesses wrong:
 * Japanese for "Okay", or Indonesian that it then translates English into.
 * Each speaker transcribes only their own mic, so each names their own.
 */

export const CAPTION_LANGUAGE_HEADER = 'X-Caption-Language';
export const CAPTION_LANGUAGE_STORAGE_KEY = 'zimail:caption-languages';

/** Whisper's codes, roughly the languages most spoken where this is used. */
export const CAPTION_LANGUAGE_CODES = [
	'en', 'id', 'ms', 'jv', 'su', 'zh', 'ja', 'ko', 'th', 'vi', 'tl', 'hi',
	'ar', 'tr', 'ru', 'fr', 'es', 'pt', 'de', 'it', 'nl'
] as const;

/** More than this and the list hardly narrows Whisper's guess any more. */
export const MAX_CAPTION_LANGUAGES = 3;

const KNOWN = new Set<string>(CAPTION_LANGUAGE_CODES);

/**
 * `en,id` in, `['en', 'id']` out: known codes only, no repeats, at most
 * `MAX_CAPTION_LANGUAGES`, in the order picked. Empty means let Whisper guess.
 */
export function captionLanguages(raw: string | null | undefined): string[] {
	const picked = new Set<string>();
	for (const code of (raw ?? '').split(',')) {
		const trimmed = code.trim();
		if (KNOWN.has(trimmed)) picked.add(trimmed);
	}
	return [...picked].slice(0, MAX_CAPTION_LANGUAGES);
}

export function languageNames(locale: string): (code: string) => string {
	let names: Intl.DisplayNames | null = null;
	try {
		names = new Intl.DisplayNames([locale], { type: 'language' });
	} catch {
		// An unknown locale tag: fall back to the codes themselves.
	}
	return (code) => names?.of(code) ?? code;
}
