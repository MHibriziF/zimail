/**
 * Live captions (#149). Each participant transcribes only their own mic, and
 * only while they speak: the browser cuts speech into short WAV segments, the
 * Worker runs Whisper on them, and the speaker broadcasts the text on
 * `CAPTION_TOPIC`. This file is the pure part — segmenting, WAV, transcript.
 */

export const CAPTION_TOPIC = 'captions';
export const CAPTION_SAMPLE_RATE = 16_000;
/** The host's attribute carrying whether captions are allowed, like the screen-share settings. */
export const CAPTIONS_ALLOWED_ATTRIBUTE = 'captions';
/** Set by anyone with captions or the transcript open; speakers only transcribe while someone has. */
export const CAPTIONS_WANTED_ATTRIBUTE = 'captionsWanted';

export type CaptionLine = { id: string; identity: string; name: string; text: string; at: number };

export type CaptionMessage = { type: 'line'; text: string } | { type: 'paused' };

const MAX_LINE_CHARS = 1_000;

export function parseCaptionMessage(raw: string): CaptionMessage | null {
	try {
		const message = JSON.parse(raw) as { type?: unknown; text?: unknown };
		if (message.type === 'paused') return { type: 'paused' };
		if (message.type === 'line' && typeof message.text === 'string' && message.text.trim()) {
			return { type: 'line', text: message.text.trim().slice(0, MAX_LINE_CHARS) };
		}
	} catch {
		// Not ours, or garbled: ignore it like any other unknown message.
	}
	return null;
}

/** 16-bit mono PCM WAV, which Whisper reads without any decoding library on either end. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	const writeText = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.codePointAt(i) ?? 0);
	};
	writeText(0, 'RIFF');
	view.setUint32(4, 36 + samples.length * 2, true);
	writeText(8, 'WAVE');
	writeText(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeText(36, 'data');
	view.setUint32(40, samples.length * 2, true);
	samples.forEach((sample, index) => {
		const clamped = Math.max(-1, Math.min(1, sample));
		view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	});
	return new Uint8Array(buffer);
}

/**
 * Averages down to `toRate`. Capture runs at the device's own rate because
 * Firefox won't connect a mic to an AudioContext at any other one.
 */
export function downsample(frame: Float32Array, fromRate: number, toRate: number): Float32Array {
	if (fromRate <= toRate) return frame;
	const ratio = fromRate / toRate;
	const out = new Float32Array(Math.floor(frame.length / ratio));
	for (let i = 0; i < out.length; i++) {
		const start = Math.floor(i * ratio);
		const end = Math.min(frame.length, Math.floor((i + 1) * ratio));
		let sum = 0;
		for (let j = start; j < end; j++) sum += frame[j];
		out[i] = sum / Math.max(1, end - start);
	}
	return out;
}

function rms(frame: Float32Array): number {
	let sum = 0;
	for (const sample of frame) sum += sample * sample;
	return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

export type SegmenterOptions = {
	sampleRate?: number;
	/** RMS above this counts as speech; about -40 dBFS, past what noise suppression leaves behind. */
	threshold?: number;
	/** Silence this long ends a segment, so a pause between words doesn't split a sentence. */
	hangoverMs?: number;
	/** A segment is cut here even mid-speech, so captions keep up with someone who never pauses. */
	maxMs?: number;
	/** Less speech than this is a cough or a click, not worth a Whisper call. */
	minSpeechMs?: number;
	/** Audio kept from just before speech starts, so the first syllable isn't clipped. */
	preRollMs?: number;
};

/**
 * Voice-gated segmenting. Frames go in as they arrive; whole spoken segments
 * come out. Silence never leaves the device, which is what keeps the neuron
 * cost to the minutes someone actually spoke.
 */
export function createSpeechSegmenter(onSegment: (samples: Float32Array) => void, options: SegmenterOptions = {}) {
	const sampleRate = options.sampleRate ?? CAPTION_SAMPLE_RATE;
	const threshold = options.threshold ?? 0.01;
	const samplesFor = (ms: number) => Math.round((ms / 1000) * sampleRate);
	const hangover = samplesFor(options.hangoverMs ?? 700);
	const max = samplesFor(options.maxMs ?? 12_000);
	const minSpeech = samplesFor(options.minSpeechMs ?? 400);
	const preRoll = samplesFor(options.preRollMs ?? 300);

	let recent: Float32Array[] = [];
	let recentLength = 0;
	let segment: Float32Array[] = [];
	let segmentLength = 0;
	let speech = 0;
	let silence = 0;

	function emit() {
		const keep = speech >= minSpeech;
		const chunks = segment;
		const length = segmentLength;
		segment = [];
		segmentLength = 0;
		speech = 0;
		silence = 0;
		if (!keep) return;
		const samples = new Float32Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			samples.set(chunk, offset);
			offset += chunk.length;
		}
		onSegment(samples);
	}

	function remember(frame: Float32Array) {
		recent.push(frame);
		recentLength += frame.length;
		while (recent.length > 1 && recentLength - recent[0].length >= preRoll) {
			recentLength -= recent[0].length;
			recent = recent.slice(1);
		}
	}

	return {
		push(frame: Float32Array) {
			const voiced = rms(frame) >= threshold;
			if (segmentLength === 0) {
				if (!voiced) {
					remember(frame);
					return;
				}
				segment = recent;
				segmentLength = recentLength;
				recent = [];
				recentLength = 0;
			}
			segment.push(frame);
			segmentLength += frame.length;
			if (voiced) {
				speech += frame.length;
				silence = 0;
			} else {
				silence += frame.length;
			}
			if (silence >= hangover || segmentLength >= max) emit();
		},
		/** Ends whatever is in progress, e.g. when the mic goes off. */
		flush() {
			if (segmentLength > 0) emit();
		}
	};
}

/** Why a speaker stopped sending: the day's AI allowance, the host turning captions off, or a rejected token. */
export type CaptionStopReason = 'limit' | 'disabled' | 'unauthorized';

const STOP_REASONS: Record<number, CaptionStopReason> = { 429: 'limit', 403: 'disabled', 401: 'unauthorized', 404: 'unauthorized' };

/**
 * Sends segments one at a time, in order. If the Worker falls behind, the
 * oldest waiting segment is dropped rather than letting captions lag further
 * and further behind the speaker.
 */
export function createCaptionUploader(options: {
	code: string;
	token: string;
	fetch: typeof fetch;
	onText: (text: string) => void;
	onStop: (reason: CaptionStopReason) => void;
	maxWaiting?: number;
}) {
	const maxWaiting = options.maxWaiting ?? 2;
	const waiting: Uint8Array[] = [];
	let busy = false;
	let stopped = false;

	async function sendOne(wav: Uint8Array) {
		try {
			const response = await options.fetch(`/api/meetings/join/${encodeURIComponent(options.code)}/captions`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'audio/wav' },
				body: wav as Uint8Array<ArrayBuffer>
			});
			const reason = STOP_REASONS[response.status];
			if (reason) {
				stopped = true;
				waiting.length = 0;
				options.onStop(reason);
				return;
			}
			if (!response.ok) return;
			const body = (await response.json().catch(() => ({}))) as { text?: unknown };
			if (typeof body.text === 'string' && body.text.trim()) options.onText(body.text.trim());
		} catch {
			// A dropped request loses one segment; the next one tries again.
		}
	}

	async function drain() {
		if (busy) return;
		busy = true;
		while (waiting.length > 0 && !stopped) await sendOne(waiting.shift() as Uint8Array);
		busy = false;
	}

	return {
		send(wav: Uint8Array) {
			if (stopped) return;
			waiting.push(wav);
			if (waiting.length > maxWaiting) waiting.shift();
			void drain();
		}
	};
}

/** Recent lines for the on-screen captions, oldest first. */
export function recentCaptions(lines: readonly CaptionLine[], now: number, windowMs = 6_000, max = 3): CaptionLine[] {
	const shown: CaptionLine[] = [];
	for (let i = lines.length - 1; i >= 0 && shown.length < max; i--) {
		if (now - lines[i].at > windowMs) break;
		shown.unshift(lines[i]);
	}
	return shown;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** `[14:05:12] Ada: Hello`, one line each, in the reader's time zone. */
export function transcriptText(lines: readonly CaptionLine[], timeZone?: string): string {
	const time = new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZone
	});
	return lines.map((line) => `[${time.format(line.at)}] ${line.name}: ${line.text}`).join('\n') + '\n';
}

function vttTime(ms: number): string {
	const whole = Math.max(0, Math.round(ms));
	const hours = Math.floor(whole / 3_600_000);
	const minutes = Math.floor((whole % 3_600_000) / 60_000);
	const seconds = Math.floor((whole % 60_000) / 1000);
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(whole % 1000, 3)}`;
}

/** WebVTT timed from the first line; each cue lasts until the next, at most `maxCueMs`. */
export function transcriptVtt(lines: readonly CaptionLine[], maxCueMs = 5_000): string {
	const start = lines[0]?.at ?? 0;
	const cues = lines.map((line, index) => {
		const next = lines[index + 1]?.at ?? Infinity;
		const end = Math.min(next, line.at + maxCueMs);
		const text = line.text.replaceAll('-->', '->');
		return `${vttTime(line.at - start)} --> ${vttTime(end - start)}\n<v ${line.name.replaceAll('>', '')}>${text}`;
	});
	return ['WEBVTT', ...cues].join('\n\n') + '\n';
}

/** `transcript-abc-defg-hij-2026-09-24-1405.txt`, in local time like recordings. */
export function transcriptFilename(code: string, startedAt: Date, extension: 'txt' | 'vtt'): string {
	const stamp = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}`;
	const safeCode = code.replaceAll(/[^a-z0-9-]/gi, '');
	const name = safeCode ? `transcript-${safeCode}` : 'transcript';
	return `${name}-${stamp}.${extension}`;
}
