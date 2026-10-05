import { isDailyLimitError, type AiBinding } from './service';

/** $0.000513 a minute of audio, about 47 neurons: the free 10,000 a day covers ~210 minutes of speech. */
export const CAPTION_MODEL = '@cf/openai/whisper-large-v3-turbo';

/** Bigger than any segment the client sends (~12 s of 16 kHz mono WAV is ~390 KB). */
export const MAX_CAPTION_AUDIO_BYTES = 512 * 1024;

export type TranscribeOutcome = { kind: 'text'; text: string } | { kind: 'limit_reached' } | { kind: 'failed' };

type WhisperResponse = { text?: unknown; transcription_info?: { language?: unknown } } | null;

/** Languages Whisper mistakes for a neighbour, so a stray guess is retried as the one meant. */
const NEIGHBOURS: Record<string, string> = { ms: 'id', jv: 'id', su: 'id', yue: 'zh' };

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const CHUNK = 0x8000;
	for (let start = 0; start < bytes.length; start += CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(start, start + CHUNK));
	}
	return btoa(binary);
}

function retryLanguage(heard: string, languages: readonly string[]): string {
	const neighbour = NEIGHBOURS[heard];
	return neighbour && languages.includes(neighbour) ? neighbour : languages[0];
}

/**
 * One spoken segment to text. Whisper invents "Thank you." over near-silence,
 * so its own voice filter runs too, and each segment stands alone rather than
 * continuing the last one, which is what lets a hallucination repeat.
 *
 * `languages` is what the speaker said they speak. One is passed to Whisper
 * outright. With several, Whisper still guesses among them, and a guess outside
 * them is transcribed again in the nearest, so only a misfire costs twice.
 */
export async function transcribeSpeech(
	ai: AiBinding,
	audio: Uint8Array,
	languages: readonly string[] = []
): Promise<TranscribeOutcome> {
	const inputs = { audio: toBase64(audio), vad_filter: true, condition_on_previous_text: false };
	const run = (language?: string) =>
		ai.run(CAPTION_MODEL, language ? { ...inputs, language } : inputs) as Promise<WhisperResponse>;
	try {
		let response = await run(languages.length === 1 ? languages[0] : undefined);
		const heard = response?.transcription_info?.language;		if (languages.length > 1 && typeof heard === 'string' && !languages.includes(heard)) {
			response = await run(retryLanguage(heard, languages));
		}
		const text = typeof response?.text === 'string' ? response.text.trim() : '';
		return { kind: 'text', text };
	} catch (error) {
		if (isDailyLimitError(error)) return { kind: 'limit_reached' };
		console.error('AI transcription failed', error);
		return { kind: 'failed' };
	}
}
