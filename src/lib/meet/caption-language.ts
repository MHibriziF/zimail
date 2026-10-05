/**
 * Which language a speaker's captions are in (#172 follow-up). Whisper guesses
 * the language afresh for every short segment, and on a word or two it guesses
 * wrong: Japanese for "Okay", or Indonesian that it then translates English
 * into. A speaker who names their language takes the guess away.
 */

export const CAPTION_LANGUAGE_HEADER = 'X-Caption-Language';
export const CAPTION_LANGUAGE_STORAGE_KEY = 'zimail:caption-language';

/** Whisper's codes for the languages offered; the app's own five plus Japanese and Korean. */
const SPOKEN = ['en', 'id', 'fr', 'es', 'zh', 'ja', 'ko'] as const;

/** `auto`, one code, or two joined by `+` for people who switch between them mid-call. */
export const CAPTION_LANGUAGE_CHOICES = ['auto', ...SPOKEN, 'en+id'] as const;

export type CaptionLanguageChoice = (typeof CAPTION_LANGUAGE_CHOICES)[number];

export function isCaptionLanguageChoice(value: unknown): value is CaptionLanguageChoice {
	return CAPTION_LANGUAGE_CHOICES.includes(value as CaptionLanguageChoice);
}

/** The languages a choice allows; empty means let Whisper guess. Anything unknown is `auto`. */
export function captionLanguages(choice: string | null | undefined): string[] {
	if (!choice || choice === 'auto' || !isCaptionLanguageChoice(choice)) return [];
	return choice.split('+');
}

/** "English + Indonesian", in the reader's language. */
export function captionLanguageLabel(choice: CaptionLanguageChoice, locale: string, autoLabel: string): string {
	if (choice === 'auto') return autoLabel;
	let names: Intl.DisplayNames | null = null;
	try {
		names = new Intl.DisplayNames([locale], { type: 'language' });
	} catch {
		// An unknown locale tag: fall back to the codes themselves.
	}
	return captionLanguages(choice)
		.map((code) => names?.of(code) ?? code)
		.join(' + ');
}
