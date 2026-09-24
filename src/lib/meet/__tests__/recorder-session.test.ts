import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { downloadBlob, recordingSupported, startRecording } from '../recorder';

/**
 * Just enough of MediaRecorder / Web Audio / getDisplayMedia to drive
 * startRecording outside a browser. The real thing was checked by hand in
 * Chrome; these pin the wiring — what gets mixed, cleanup, and stop().
 */

type FakeTrack = MediaStreamTrack & { fire(event: string): void };

function fakeTrack(kind: 'audio' | 'video', id: string, readyState: 'live' | 'ended' = 'live'): FakeTrack {
	const listeners = new Map<string, (() => void)[]>();
	return {
		kind,
		id,
		readyState,
		stopped: false,
		stop() {
			(this as unknown as { stopped: boolean }).stopped = true;
		},
		addEventListener(event: string, listener: () => void) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		},
		fire(event: string) {
			for (const listener of listeners.get(event) ?? []) listener();
		}
	} as unknown as FakeTrack;
}

class FakeMediaStream {
	constructor(public tracks: MediaStreamTrack[] = []) {}
	getTracks() {
		return this.tracks;
	}
	getAudioTracks() {
		return this.tracks.filter((track) => track.kind === 'audio');
	}
	getVideoTracks() {
		return this.tracks.filter((track) => track.kind === 'video');
	}
}

let contexts: FakeAudioContext[] = [];
class FakeAudioContext {
	state = 'suspended';
	closed = false;
	connected: string[] = [];
	disconnected: string[] = [];
	mixTrack = fakeTrack('audio', 'mix');
	constructor() {
		contexts.push(this);
	}
	async resume() {
		this.state = 'running';
	}
	async close() {
		this.closed = true;
	}
	createMediaStreamDestination() {
		return { stream: new FakeMediaStream([this.mixTrack]) };
	}
	createMediaStreamSource(stream: FakeMediaStream) {
		const id = stream.tracks[0].id;
		return {
			connect: () => this.connected.push(id),
			disconnect: () => this.disconnected.push(id)
		};
	}
}

let recorders: FakeMediaRecorder[] = [];
class FakeMediaRecorder {
	static supported = new Set(['video/webm']);
	static isTypeSupported(type: string) {
		return FakeMediaRecorder.supported.has(type);
	}
	state = 'inactive';
	timeslice = 0;
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: (() => void) | null = null;
	constructor(
		public stream: FakeMediaStream,
		public options: { mimeType: string }
	) {
		recorders.push(this);
	}
	start(timeslice: number) {
		this.state = 'recording';
		this.timeslice = timeslice;
	}
	stop() {
		this.state = 'inactive';
		this.ondataavailable?.({ data: new Blob(['chunk-1']) });
		this.ondataavailable?.({ data: new Blob([]) });
		this.onstop?.();
	}
}

let display: FakeMediaStream;
let displayError: Error | null = null;
const globals = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeEach(() => {
	contexts = [];
	recorders = [];
	displayError = null;
	display = new FakeMediaStream([fakeTrack('video', 'screen')]);
	for (const key of ['MediaRecorder', 'AudioContext', 'MediaStream', 'navigator']) saved[key] = globals[key];
	globals.MediaRecorder = FakeMediaRecorder;
	globals.AudioContext = FakeAudioContext;
	globals.MediaStream = FakeMediaStream;
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			mediaDevices: {
				getDisplayMedia: async () => {
					if (displayError) throw displayError;
					return display;
				}
			}
		}
	});
});

afterEach(() => {
	for (const key of ['MediaRecorder', 'AudioContext', 'MediaStream']) globals[key] = saved[key];
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: saved.navigator });
});

describe('startRecording', () => {
	test('mixes the mic and every remote voice when the tab gives no audio, and resumes the context', async () => {
		const recording = await startRecording({
			micTrack: fakeTrack('audio', 'mic'),
			remoteAudioTracks: [fakeTrack('audio', 'ana'), fakeTrack('audio', 'bo')],
			onEnded: () => undefined
		});
		assert.equal(recording.mixesRemoteAudio, true);
		assert.deepEqual(contexts[0].connected, ['mic', 'ana', 'bo']);
		assert.equal(contexts[0].state, 'running');
		assert.equal(recorders[0].options.mimeType, 'video/webm');
		assert.equal(recorders[0].timeslice, 1000);
		assert.deepEqual(
			recorders[0].stream.tracks.map((track) => track.id),
			['screen', 'mix']
		);
	});

	test('with tab audio, only the mic is added — the others are already in it', async () => {
		display = new FakeMediaStream([fakeTrack('video', 'screen'), fakeTrack('audio', 'tab')]);
		const recording = await startRecording({
			micTrack: fakeTrack('audio', 'mic'),
			remoteAudioTracks: [fakeTrack('audio', 'ana')],
			onEnded: () => undefined
		});
		assert.equal(recording.mixesRemoteAudio, false);
		assert.deepEqual(contexts[0].connected, ['tab', 'mic']);
	});

	test('tracks can join and leave the mix; duplicates and ended tracks are ignored', async () => {
		const recording = await startRecording({ micTrack: null, remoteAudioTracks: [], onEnded: () => undefined });
		const late = fakeTrack('audio', 'late');
		recording.addAudioTrack(late);
		recording.addAudioTrack(late);
		recording.addAudioTrack(fakeTrack('audio', 'gone', 'ended'));
		recording.removeAudioTrack(late);
		assert.deepEqual(contexts[0].connected, ['late']);
		assert.deepEqual(contexts[0].disconnected, ['late']);
	});

	test('stop returns the recorded file once, then cleans up capture and audio', async () => {
		const recording = await startRecording({ micTrack: null, remoteAudioTracks: [], onEnded: () => undefined });
		const [first, second] = await Promise.all([recording.stop(), recording.stop()]);
		assert.equal(first, second);
		assert.equal(first.type, 'video/webm');
		assert.equal(await first.text(), 'chunk-1');
		assert.equal((display.tracks[0] as unknown as { stopped: boolean }).stopped, true);
		assert.equal(contexts[0].closed, true);
	});

	test('the browser ending the capture tells the caller', async () => {
		let ended = 0;
		await startRecording({ micTrack: null, remoteAudioTracks: [], onEnded: () => ended++ });
		(display.tracks[0] as FakeTrack).fire('ended');
		assert.equal(ended, 1);
	});

	test('a cancelled picker closes the audio context and rethrows', async () => {
		displayError = new Error('NotAllowedError');
		await assert.rejects(
			startRecording({ micTrack: null, remoteAudioTracks: [], onEnded: () => undefined }),
			/NotAllowedError/
		);
		assert.equal(contexts[0].closed, true);
		assert.equal(recorders.length, 0);
	});

	test('no supported format means no recording', async () => {
		FakeMediaRecorder.supported = new Set();
		try {
			assert.equal(recordingSupported(), false);
			await assert.rejects(startRecording({ micTrack: null, remoteAudioTracks: [], onEnded: () => undefined }));
		} finally {
			FakeMediaRecorder.supported = new Set(['video/webm']);
		}
		assert.equal(recordingSupported(), true);
	});
});

describe('downloadBlob', () => {
	test('clicks a temporary link carrying the file name', () => {
		const clicked: { href: string; download: string }[] = [];
		const link = {
			href: '',
			download: '',
			click() {
				clicked.push({ href: this.href, download: this.download });
			},
			remove() {}
		};
		const savedDocument = globals.document;
		const savedCreate = URL.createObjectURL;
		globals.document = { createElement: () => link, body: { append() {} } };
		URL.createObjectURL = () => 'blob:fake';
		try {
			downloadBlob(new Blob(['x']), 'meeting.webm');
		} finally {
			globals.document = savedDocument;
			URL.createObjectURL = savedCreate;
		}
		assert.deepEqual(clicked, [{ href: 'blob:fake', download: 'meeting.webm' }]);
	});
});
