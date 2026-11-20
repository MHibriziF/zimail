/**
 * Who is speaking, measured in this browser from the audio it already plays.
 * LiveKit's own active-speaker updates come from the server a few times a
 * second, smoothed, so the ring trailed the voice by most of a second.
 */

/** How loud a frame is: the root mean square of its samples, 0 for silence up to 1. */
export function rms(samples: Float32Array | readonly number[]): number {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.sqrt(sum / samples.length);
}

export type SpeakingGateOptions = {
	/** Quieter than this is silence. Speech through a noise-suppressed mic sits well above it. */
	threshold?: number;
	/** Loud frames in a row before it counts, so a cough or a click doesn't light the tile. */
	attackFrames?: number;
	/** How long it stays lit after the voice drops, so the pauses between words don't flicker. */
	holdMs?: number;
};

/** Turns a stream of levels into speaking or not: on quickly, off only after a pause. */
export function createSpeakingGate({ threshold = 0.015, attackFrames = 2, holdMs = 500 }: SpeakingGateOptions = {}) {
	let loudFrames = 0;
	let lastLoudAt = Number.NEGATIVE_INFINITY;
	let speaking = false;
	return {
		update(level: number, now: number): boolean {
			if (level >= threshold) {
				loudFrames += 1;
				lastLoudAt = now;
				if (loudFrames >= attackFrames) speaking = true;
			} else {
				loudFrames = 0;
				if (now - lastLoudAt >= holdMs) speaking = false;
			}
			return speaking;
		}
	};
}
