import { createSpeakingGate, rms } from './speaking';

const SAMPLE_EVERY_MS = 50;
const FRAME_SIZE = 512;

type AudioGraph = {
	readonly state: AudioContextState;
	createMediaStreamSource(stream: MediaStream): Pick<MediaStreamAudioSourceNode, 'connect' | 'disconnect'>;
	createAnalyser(): Pick<AnalyserNode, 'fftSize' | 'getFloatTimeDomainData'>;
	resume(): Promise<void>;
	close(): Promise<void>;
};

export type SpeakingDetectorDeps = {
	createContext: () => AudioGraph;
	streamOf: (track: MediaStreamTrack) => MediaStream;
	now: () => number;
	every: (tick: () => void, ms: number) => unknown;
	cancel: (timer: unknown) => void;
};

const browserDeps: SpeakingDetectorDeps = {
	createContext: () => new AudioContext(),
	streamOf: (track) => new MediaStream([track]),
	now: () => performance.now(),
	every: (tick, ms) => setInterval(tick, ms),
	cancel: (timer) => clearInterval(timer as ReturnType<typeof setInterval>)
};

type Watched = {
	track: MediaStreamTrack;
	source: ReturnType<AudioGraph['createMediaStreamSource']>;
	analyser: ReturnType<AudioGraph['createAnalyser']>;
	gate: ReturnType<typeof createSpeakingGate>;
	frame: Float32Array<ArrayBuffer>;
	speaking: boolean;
};

/**
 * Measures, in this browser, how loud each participant's microphone is, and
 * says when each starts and stops speaking. One AudioContext serves everyone;
 * it only listens (nothing is connected to the speakers), and it samples only
 * while there is a track to watch.
 */
export class SpeakingDetector {
	private context: AudioGraph | null = null;
	private readonly watched = new Map<string, Watched>();
	private timer: unknown = null;

	constructor(
		private readonly onChange: (id: string, speaking: boolean) => void,
		private readonly deps: SpeakingDetectorDeps = browserDeps
	) {}

	/** Measuring needs a running AudioContext; until the browser allows one, LiveKit's own updates stand in. */
	get running(): boolean {
		return this.context?.state === 'running';
	}

	/** Starts listening to `id`'s microphone, or to its new track after a device switch. */
	watch(id: string, track: MediaStreamTrack) {
		if (this.watched.get(id)?.track === track) return;
		this.unwatch(id);
		const context = this.ensureContext();
		const source = context.createMediaStreamSource(this.deps.streamOf(track));
		const analyser = context.createAnalyser();
		analyser.fftSize = FRAME_SIZE;
		source.connect(analyser as AnalyserNode);
		this.watched.set(id, {
			track,
			source,
			analyser,
			gate: createSpeakingGate(),
			frame: new Float32Array(FRAME_SIZE),
			speaking: false
		});
		this.timer ??= this.deps.every(() => this.sample(), SAMPLE_EVERY_MS);
	}

	/** Stops listening to `id`; with a track, only if it is still that one (a stale unsubscribe after a switch). */
	unwatch(id: string, track?: MediaStreamTrack) {
		const entry = this.watched.get(id);
		if (!entry || (track && entry.track !== track)) return;
		entry.source.disconnect();
		this.watched.delete(id);
		if (entry.speaking) this.onChange(id, false);
		if (this.watched.size === 0) this.stopSampling();
	}

	stop() {
		for (const id of [...this.watched.keys()]) this.unwatch(id);
		void this.context?.close().catch(() => undefined);
		this.context = null;
	}

	private ensureContext(): AudioGraph {
		this.context ??= this.deps.createContext();
		// Joining took a click, so the browser normally lets it run; if not, it stays suspended and LiveKit's updates are used.
		if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
		return this.context;
	}

	private stopSampling() {
		if (this.timer === null) return;
		this.deps.cancel(this.timer);
		this.timer = null;
	}

	private sample() {
		if (!this.running) return;
		const now = this.deps.now();
		for (const [id, entry] of this.watched) {
			entry.analyser.getFloatTimeDomainData(entry.frame);
			const speaking = entry.gate.update(rms(entry.frame), now);
			if (speaking === entry.speaking) continue;
			entry.speaking = speaking;
			this.onChange(id, speaking);
		}
	}
}
