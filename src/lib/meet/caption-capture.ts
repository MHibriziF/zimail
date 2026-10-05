import { CAPTION_SAMPLE_RATE, createSpeechSegmenter, downsample, encodeWav } from './captions';

/** Hands the mic's samples to the page in ~85 ms blocks; the audio thread does nothing else. */
const TAP_SCRIPT = `class CaptionTap extends AudioWorkletProcessor {
	constructor() { super(); this.block = new Float32Array(4096); this.filled = 0; }
	process(inputs) {
		const input = inputs[0] && inputs[0][0];
		if (!input) return true;
		let offset = 0;
		while (offset < input.length) {
			const count = Math.min(input.length - offset, this.block.length - this.filled);
			this.block.set(input.subarray(offset, offset + count), this.filled);
			this.filled += count;
			offset += count;
			if (this.filled === this.block.length) { this.port.postMessage(this.block.slice()); this.filled = 0; }
		}
		return true;
	}
}
registerProcessor('caption-tap', CaptionTap);`;

export function captionCaptureSupported(): boolean {
	return typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
}

/**
 * Listens to one mic track and calls `onSegment` with a WAV for each stretch
 * of speech. Returns a stop function, which also hands over speech in progress.
 */
export async function startCaptionCapture(
	track: MediaStreamTrack,
	onSegment: (wav: Uint8Array) => void
): Promise<() => void> {
	const context = new AudioContext();
	try {
		const url = URL.createObjectURL(new Blob([TAP_SCRIPT], { type: 'text/javascript' }));
		try {
			await context.audioWorklet.addModule(url);
		} finally {
			URL.revokeObjectURL(url);
		}
		const source = context.createMediaStreamSource(new MediaStream([track]));
		const tap = new AudioWorkletNode(context, 'caption-tap', { numberOfInputs: 1, numberOfOutputs: 0 });
		const segmenter = createSpeechSegmenter((samples) => onSegment(encodeWav(samples, CAPTION_SAMPLE_RATE)));
		tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
			segmenter.push(downsample(event.data, context.sampleRate, CAPTION_SAMPLE_RATE));
		};
		source.connect(tap);
		if (context.state === 'suspended') await context.resume().catch(() => {});
		return () => {
			segmenter.flush();
			tap.port.onmessage = null;
			source.disconnect();
			void context.close().catch(() => {});
		};
	} catch (error) {
		void context.close().catch(() => {});
		throw error;
	}
}
