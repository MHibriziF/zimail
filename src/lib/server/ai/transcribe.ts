import { isDailyLimitError, type AiBinding } from './service';

/** $0.000513 a minute of audio, about 47 neurons: the free 10,000 a day covers ~210 minutes of speech. */
export const CAPTION_MODEL = '@cf/openai/whisper-large-v3-turbo';

/** Bigger than any segment the client sends (~12 s of 16 kHz mono WAV is ~390 KB). */
export const MAX_CAPTION_AUDIO_BYTES = 512 * 1024;

export type TranscribeOutcome = { kind: 'text'; text: string } | { kind: 'limit_reached' } | { kind: 'failed' };

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	const CHUNK = 0x8000;
	for (let start = 0; start < bytes.length; start += CHUNK) {
		binary += String.fromCodePoint(...bytes.subarray(start, start + CHUNK));
	}
	return btoa(binary);
}

/**
 * One spoken segment to text. Whisper invents "Thank you." over near-silence,
 * so its own voice filter runs too, and each segment stands alone rather than
 * continuing the last one, which is what lets a hallucination repeat.
 *
 * `language` is what the speaker said they speak; without it Whisper guesses.
 */
export async function transcribeSpeech(ai: AiBinding, audio: Uint8Array, language = ''): Promise<TranscribeOutcome> {
	try {
		const response = (await ai.run(CAPTION_MODEL, {
			audio: toBase64(audio),
			vad_filter: true,
			condition_on_previous_text: false,
			...(language ? { language } : {})
		})) as { text?: unknown } | null;
		const text = typeof response?.text === 'string' ? response.text.trim() : '';
		return { kind: 'text', text };
	} catch (error) {
		if (isDailyLimitError(error)) return { kind: 'limit_reached' };
		console.error('AI transcription failed', error);
		return { kind: 'failed' };
	}
}
