/**
 * Records a call in the browser: the screen (normally this tab) plus a Web
 * Audio mix of the call's voices, written by MediaRecorder and saved locally.
 * Nothing leaves the device — LiveKit Egress would do this server-side, but
 * it's billed per minute.
 */

/** In preference order: MP4 plays everywhere where it's offered; WebM is the portable fallback. */
const MIME_CANDIDATES = [
	'video/mp4;codecs=avc1,mp4a',
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm'
];

export function pickMimeType(isTypeSupported: (type: string) => boolean): string | null {
	return MIME_CANDIDATES.find((type) => isTypeSupported(type)) ?? null;
}

export function recordingSupported(): boolean {
	return (
		typeof MediaRecorder !== 'undefined' &&
		typeof navigator !== 'undefined' &&
		typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
		pickMimeType((type) => MediaRecorder.isTypeSupported(type)) !== null
	);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `meeting-abc-defg-hij-2026-09-24-1405.webm`, in the recorder's local time. */
export function recordingFilename(code: string, startedAt: Date, mimeType: string): string {
	const stamp = `${startedAt.getFullYear()}-${pad(startedAt.getMonth() + 1)}-${pad(startedAt.getDate())}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}`;
	const safeCode = code.replaceAll(/[^a-z0-9-]/gi, '');
	const extension = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
	const name = safeCode ? `meeting-${safeCode}` : 'meeting';
	return `${name}-${stamp}.${extension}`;
}

/** `75` → `01:15`; an hour or more shows hours too. */
export function formatElapsed(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const rest = `${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
	return hours > 0 ? `${hours}:${rest}` : rest;
}

/**
 * Which voices go into the mix. When the browser hands over the tab's own
 * audio, the other participants are already in it (they play in this tab), so
 * adding their tracks again would double them; only the recorder's own mic,
 * which the tab never plays, is missing.
 */
export function shouldMixRemoteAudio(displayHasAudio: boolean): boolean {
	return !displayHasAudio;
}

export type ActiveRecording = {
	mimeType: string;
	startedAt: Date;
	/** Whether remote voices are mixed in individually (see `shouldMixRemoteAudio`). */
	mixesRemoteAudio: boolean;
	addAudioTrack(track: MediaStreamTrack): void;
	removeAudioTrack(track: MediaStreamTrack): void;
	/** Finishes and returns the file. Safe to call twice. */
	stop(): Promise<Blob>;
};

type DisplayMediaOptions = DisplayMediaStreamOptions & {
	preferCurrentTab?: boolean;
	selfBrowserSurface?: 'include' | 'exclude';
	systemAudio?: 'include' | 'exclude';
};

/** The Web Audio mix a recording's sound comes from; tracks join and leave as people do. */
export type AudioMix = {
	track: MediaStreamTrack;
	add(track: MediaStreamTrack): void;
	remove(track: MediaStreamTrack): void;
};

export function createAudioMix(context: AudioContext): AudioMix {
	const destination = context.createMediaStreamDestination();
	const sources = new Map<string, MediaStreamAudioSourceNode>();
	return {
		track: destination.stream.getAudioTracks()[0],
		add(track) {
			if (sources.has(track.id) || track.readyState === 'ended') return;
			const source = context.createMediaStreamSource(new MediaStream([track]));
			source.connect(destination);
			sources.set(track.id, source);
		},
		remove(track) {
			sources.get(track.id)?.disconnect();
			sources.delete(track.id);
		}
	};
}

/**
 * Runs MediaRecorder over `stream` and returns a `stop` that is safe to call
 * twice. `cleanup` runs once the file is complete.
 */
export function recordStream(
	stream: MediaStream,
	mimeType: string,
	cleanup: () => Promise<void> | void
): () => Promise<Blob> {
	const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
	const chunks: Blob[] = [];
	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	};
	const finished = new Promise<Blob>((resolve) => {
		recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
	});
	// A one-second timeslice keeps memory in small chunks and loses at most a second if the tab dies.
	recorder.start(1000);

	let stopping: Promise<Blob> | null = null;
	return () => {
		stopping ??= (async () => {
			if (recorder.state !== 'inactive') recorder.stop();
			const blob = await finished;
			await cleanup();
			return blob;
		})();
		return stopping;
	};
}

/**
 * "Record my view": asks for the screen (throws if the person cancels the
 * picker), then records what it shows. `onEnded` fires if capture stops from
 * outside — the browser's own "Stop sharing" bar — so the caller can save.
 */
export async function startRecording(options: {
	micTrack: MediaStreamTrack | null;
	remoteAudioTracks: MediaStreamTrack[];
	onEnded: () => void;
}): Promise<ActiveRecording> {
	const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
	if (!mimeType) throw new Error('Recording is not supported in this browser');

	// Made before the first await, while the click that started this still counts as a user
	// gesture — an AudioContext created after it can start suspended and record silence.
	const context = new AudioContext();
	let display: MediaStream;
	try {
		display = await navigator.mediaDevices.getDisplayMedia({
			video: { frameRate: 30 },
			audio: true,
			preferCurrentTab: true,
			selfBrowserSurface: 'include',
			systemAudio: 'exclude'
		} as DisplayMediaOptions);
		if (context.state === 'suspended') await context.resume();
	} catch (error) {
		await context.close().catch(() => undefined);
		throw error;
	}

	const mix = createAudioMix(context);
	const displayAudio = display.getAudioTracks();
	const mixesRemoteAudio = shouldMixRemoteAudio(displayAudio.length > 0);
	for (const track of displayAudio) mix.add(track);
	if (options.micTrack) mix.add(options.micTrack);
	if (mixesRemoteAudio) for (const track of options.remoteAudioTracks) mix.add(track);

	const stream = new MediaStream([...display.getVideoTracks(), mix.track]);
	const stop = recordStream(stream, mimeType, async () => {
		for (const track of display.getTracks()) track.stop();
		await context.close().catch(() => undefined);
	});
	for (const track of display.getVideoTracks()) track.addEventListener('ended', options.onEnded, { once: true });

	return {
		mimeType,
		startedAt: new Date(),
		mixesRemoteAudio,
		addAudioTrack: mix.add,
		removeAudioTrack: mix.remove,
		stop
	};
}

export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	// Revoking straight away can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
