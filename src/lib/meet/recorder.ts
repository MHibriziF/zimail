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

/**
 * Asks for the screen (throws if the person cancels the picker), then starts
 * recording. `onEnded` fires if capture stops from outside — the browser's own
 * "Stop sharing" bar — so the caller can save what was recorded.
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

	const mix = context.createMediaStreamDestination();
	const sources = new Map<string, MediaStreamAudioSourceNode>();

	const addAudioTrack = (track: MediaStreamTrack) => {
		if (sources.has(track.id) || track.readyState === 'ended') return;
		const source = context.createMediaStreamSource(new MediaStream([track]));
		source.connect(mix);
		sources.set(track.id, source);
	};
	const removeAudioTrack = (track: MediaStreamTrack) => {
		sources.get(track.id)?.disconnect();
		sources.delete(track.id);
	};

	const displayAudio = display.getAudioTracks();
	const mixesRemoteAudio = shouldMixRemoteAudio(displayAudio.length > 0);
	for (const track of displayAudio) addAudioTrack(track);
	if (options.micTrack) addAudioTrack(options.micTrack);
	if (mixesRemoteAudio) for (const track of options.remoteAudioTracks) addAudioTrack(track);

	const stream = new MediaStream([...display.getVideoTracks(), ...mix.stream.getAudioTracks()]);
	const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
	const chunks: Blob[] = [];
	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	};
	const finished = new Promise<Blob>((resolve) => {
		recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
	});

	let stopping: Promise<Blob> | null = null;
	const stop = () => {
		stopping ??= (async () => {
			if (recorder.state !== 'inactive') recorder.stop();
			const blob = await finished;
			for (const track of display.getTracks()) track.stop();
			await context.close().catch(() => undefined);
			return blob;
		})();
		return stopping;
	};

	for (const track of display.getVideoTracks()) track.addEventListener('ended', options.onEnded, { once: true });
	// A one-second timeslice keeps memory in small chunks and loses at most a second if the tab dies.
	recorder.start(1000);

	return { mimeType, startedAt: new Date(), mixesRemoteAudio, addAudioTrack, removeAudioTrack, stop };
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
