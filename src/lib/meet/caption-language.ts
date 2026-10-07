/**
 * The language a speaker's captions are in. Whisper guesses the language
 * afresh for every short segment, and on a word or two it guesses wrong:
 * Japanese for "Okay", or Indonesian that it then translates English into.
 * Each speaker transcribes only their own mic, so each names their own.
 */

export const CAPTION_LANGUAGE_HEADER = 'X-Caption-Language';
export const CAPTION_LANGUAGE_STORAGE_KEY = 'zimail:caption-language';

/** Whisper's codes, roughly the languages most spoken where this is used. */
export const CAPTION_LANGUAGE_CODES = [
	'en', 'id', 'ms', 'jv', 'su', 'zh', 'ja', 'ko', 'th', 'vi', 'tl', 'hi',
	'ar', 'tr', 'ru', 'fr', 'es', 'pt', 'de', 'it', 'nl'
] as const;

const KNOWN = new Set<string>(CAPTION_LANGUAGE_CODES);

/** A known code, or `''` to let Whisper guess. */
export function captionLanguage(raw: string | null | undefined): string {
	const code = (raw ?? '').trim();
	return KNOWN.has(code) ? code : '';
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
