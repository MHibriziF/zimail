import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createSpeakingGate, rms } from '../speaking';
import { SpeakingDetector, type SpeakingDetectorDeps } from '../speaking-detector';

describe('how loud a frame is', () => {
	test('silence is 0 and a full-scale square wave is 1', () => {
		assert.equal(rms(new Float32Array(8)), 0);
		assert.equal(rms([1, -1, 1, -1]), 1);
	});

	test('an empty frame is silence', () => {
		assert.equal(rms([]), 0);
	});
});

describe('deciding someone is speaking', () => {
	test('it lights after two loud frames in a row, not one', () => {
		const gate = createSpeakingGate();
		assert.equal(gate.update(0.2, 0), false);
		assert.equal(gate.update(0.2, 50), true);
	});

	test('a single click between quiet frames never lights it', () => {
		const gate = createSpeakingGate();
		for (const [index, level] of [0, 0.3, 0, 0.3, 0].entries()) assert.equal(gate.update(level, index * 50), false);
	});

	test('a pause between words keeps it lit, a longer silence turns it off', () => {
		const gate = createSpeakingGate({ holdMs: 500 });
		gate.update(0.2, 0);
		gate.update(0.2, 50);
		assert.equal(gate.update(0, 300), true);
		assert.equal(gate.update(0, 549), true);
		assert.equal(gate.update(0, 550), false);
	});

	test('background hiss under the threshold is silence', () => {
		const gate = createSpeakingGate({ threshold: 0.015 });
		for (let i = 0; i < 10; i++) assert.equal(gate.update(0.01, i * 50), false);
	});
});

/** A stand-in for the browser's audio graph: each track's level is whatever the test sets. */
function fakeAudio(state: AudioContextState = 'running') {
	const levels = new Map<MediaStreamTrack, number>();
	const disconnected: MediaStreamTrack[] = [];
	let tick: (() => void) | null = null;
	let now = 0;
	let contexts = 0;
	let closed = false;
	const deps: SpeakingDetectorDeps = {
		createContext: () => {
			contexts += 1;
			return {
				state,
				createMediaStreamSource: (stream) => {
					const track = (stream as unknown as { track: MediaStreamTrack }).track;
					let analysed: MediaStreamTrack | null = null;
					return {
						connect: ((analyser: { track?: MediaStreamTrack }) => {
							analyser.track = track;
							analysed = track;
						}) as never,
						disconnect: (() => analysed && disconnected.push(analysed)) as never
					};
				},
				createAnalyser: () => {
					const analyser = {
						fftSize: 0,
						track: undefined as MediaStreamTrack | undefined,
						getFloatTimeDomainData: (frame: Float32Array) => frame.fill(levels.get(analyser.track!) ?? 0)
					};
					return analyser;
				},
				resume: async () => undefined,
				close: async () => {
					closed = true;
				}
			};
		},
		streamOf: (track) => ({ track }) as unknown as MediaStream,
		now: () => now,
		every: (fn) => {
			tick = fn;
			return 1;
		},
		cancel: () => {
			tick = null;
		}
	};
	return {
		deps,
		levels,
		disconnected,
		get sampling() {
			return tick !== null;
		},
		get contexts() {
			return contexts;
		},
		get closed() {
			return closed;
		},
		/** Runs `frames` samples 50 ms apart. */
		advance(frames: number) {
			for (let i = 0; i < frames; i++) {
				now += 50;
				tick?.();
			}
		}
	};
}

const track = (id: string) => ({ id }) as MediaStreamTrack;

describe('the speaking detector', () => {
	test('reports someone starting to speak within two samples, and stopping after the hold', () => {
		const audio = fakeAudio();
		const changes: string[] = [];
		const detector = new SpeakingDetector((id, speaking) => changes.push(`${id}:${speaking}`), audio.deps);
		const ana = track('ana');
		detector.watch('ana', ana);
		audio.levels.set(ana, 0.2);
		audio.advance(2);
		assert.deepEqual(changes, ['ana:true']);
		audio.levels.set(ana, 0);
		audio.advance(12);
		assert.deepEqual(changes, ['ana:true', 'ana:false']);
	});

	test('everyone shares one audio context, and sampling stops when nobody is left', () => {
		const audio = fakeAudio();
		const detector = new SpeakingDetector(() => undefined, audio.deps);
		detector.watch('ana', track('ana'));
		detector.watch('bo', track('bo'));
		assert.equal(audio.contexts, 1);
		assert.ok(audio.sampling);
		detector.unwatch('ana');
		detector.unwatch('bo');
		assert.equal(audio.sampling, false);
	});

	test('someone leaving mid-sentence is reported as stopped', () => {
		const audio = fakeAudio();
		const changes: string[] = [];
		const detector = new SpeakingDetector((id, speaking) => changes.push(`${id}:${speaking}`), audio.deps);
		const ana = track('ana');
		detector.watch('ana', ana);
		audio.levels.set(ana, 0.2);
		audio.advance(2);
		detector.unwatch('ana');
		assert.deepEqual(changes, ['ana:true', 'ana:false']);
		assert.deepEqual(audio.disconnected, [ana]);
	});

	test('a switched microphone replaces the old track, and a late unsubscribe of the old one is ignored', () => {
		const audio = fakeAudio();
		const detector = new SpeakingDetector(() => undefined, audio.deps);
		const oldMic = track('old');
		const newMic = track('new');
		detector.watch('me', oldMic);
		detector.watch('me', newMic);
		assert.deepEqual(audio.disconnected, [oldMic]);
		detector.unwatch('me', oldMic);
		assert.ok(audio.sampling, 'still watching the new mic');
	});

	test('watching the same track again changes nothing', () => {
		const audio = fakeAudio();
		const detector = new SpeakingDetector(() => undefined, audio.deps);
		const ana = track('ana');
		detector.watch('ana', ana);
		detector.watch('ana', ana);
		assert.deepEqual(audio.disconnected, []);
	});

	test('while the browser keeps audio suspended it reports nothing, so LiveKit’s updates are used', () => {
		const audio = fakeAudio('suspended');
		const changes: string[] = [];
		const detector = new SpeakingDetector((id, speaking) => changes.push(`${id}:${speaking}`), audio.deps);
		const ana = track('ana');
		detector.watch('ana', ana);
		audio.levels.set(ana, 0.2);
		audio.advance(4);
		assert.equal(detector.running, false);
		assert.deepEqual(changes, []);
	});

	test('stopping lets go of every track and closes the context', () => {
		const audio = fakeAudio();
		const detector = new SpeakingDetector(() => undefined, audio.deps);
		detector.watch('ana', track('ana'));
		detector.stop();
		assert.equal(audio.sampling, false);
		assert.ok(audio.closed);
		assert.equal(detector.running, false);
	});
});
