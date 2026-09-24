/**
 * "Record meeting": the call itself, not the recorder's screen. Every
 * participant's camera (or their initials when it's off) and any screen share
 * are drawn onto a canvas in a clean layout — no controls, panels or menus —
 * and recorded with a mix of everyone's voices, the recorder's own included.
 *
 * It still runs in the host's browser (LiveKit Egress would do this on the
 * server, but is billed per minute), so the host's tab has to stay open.
 */
import { createAudioMix, pickMimeType, recordStream, type ActiveRecording } from './recorder';

export type CompositeSource = {
	/** Stable per tile, so its video element is reused frame to frame. */
	key: string;
	label: string;
	/** The camera or screen track, or `null` to draw the participant's initials. */
	video: MediaStreamTrack | null;
	screen: boolean;
	color: string;
	initials: string;
};

export type Rect = { x: number; y: number; width: number; height: number };

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const GAP = 8;
const BACKGROUND = '#0b0b0d';

export function meetingRecordingSupported(): boolean {
	return (
		typeof MediaRecorder !== 'undefined' &&
		typeof HTMLCanvasElement !== 'undefined' &&
		typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
		pickMimeType((type) => MediaRecorder.isTypeSupported(type)) !== null
	);
}

function grid(count: number, area: Rect): Rect[] {
	if (count === 0) return [];
	const columns = Math.ceil(Math.sqrt(count));
	const rows = Math.ceil(count / columns);
	const width = (area.width - GAP * (columns + 1)) / columns;
	const height = (area.height - GAP * (rows + 1)) / rows;
	return Array.from({ length: count }, (_, index) => ({
		x: area.x + GAP + (index % columns) * (width + GAP),
		y: area.y + GAP + Math.floor(index / columns) * (height + GAP),
		width,
		height
	}));
}

/**
 * Where each tile goes, in `sources` order with screens first. With a screen
 * share it takes the stage and everyone else sits in a column beside it;
 * otherwise everyone shares an even grid.
 */
export function layoutTiles(count: number, screens: number, width = WIDTH, height = HEIGHT): Rect[] {
	if (screens === 0) return grid(count, { x: 0, y: 0, width, height });
	const stageWidth = Math.round(width * 0.78);
	const stage: Rect = { x: GAP, y: GAP, width: stageWidth - GAP * 2, height: height - GAP * 2 };
	const others = count - 1;
	if (others === 0) return [stage];
	const columnWidth = width - stageWidth - GAP;
	const tileHeight = Math.min((height - GAP * (others + 1)) / others, (columnWidth * 9) / 16);
	return [
		stage,
		...Array.from({ length: others }, (_, index) => ({
			x: stageWidth,
			y: GAP + index * (tileHeight + GAP),
			width: columnWidth,
			height: tileHeight
		}))
	];
}

/** Screens first: the first one is the one that gets the stage. */
export function orderSources(sources: CompositeSource[]): CompositeSource[] {
	return [...sources.filter((source) => source.screen), ...sources.filter((source) => !source.screen)];
}

/**
 * Browsers slow a background tab's timers to about once a second, which would
 * freeze the recording whenever the host looked at another tab. A worker's
 * timer isn't throttled that way, so it drives the frames when it can.
 */
function startTicker(onTick: () => void): () => void {
	try {
		const script = 'let t;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
		const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
		const worker = new Worker(url);
		worker.onmessage = onTick;
		worker.postMessage(1000 / FPS);
		return () => {
			worker.terminate();
			URL.revokeObjectURL(url);
		};
	} catch {
		const timer = setInterval(onTick, 1000 / FPS);
		return () => clearInterval(timer);
	}
}

/** Fits a frame into a rect: `cover` crops a camera to fill its tile, `contain` keeps a whole screen visible. */
function fit(sourceWidth: number, sourceHeight: number, rect: Rect, mode: 'cover' | 'contain'): Rect {
	const scale =
		mode === 'cover'
			? Math.max(rect.width / sourceWidth, rect.height / sourceHeight)
			: Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
	const width = sourceWidth * scale;
	const height = sourceHeight * scale;
	return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
}

function drawAvatar(ctx: CanvasRenderingContext2D, source: CompositeSource, rect: Rect): void {
	ctx.fillStyle = '#1c1c21';
	ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
	const radius = Math.min(rect.width, rect.height) * 0.18;
	ctx.fillStyle = source.color;
	ctx.beginPath();
	ctx.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, radius, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#fff';
	ctx.font = `600 ${Math.round(radius * 0.8)}px system-ui, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(source.initials, rect.x + rect.width / 2, rect.y + rect.height / 2);
}

function drawLabel(ctx: CanvasRenderingContext2D, label: string, rect: Rect): void {
	const size = Math.max(12, Math.min(18, rect.height / 12));
	ctx.font = `500 ${size}px system-ui, sans-serif`;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	const width = Math.min(ctx.measureText(label).width + size, rect.width - 16);
	ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
	ctx.fillRect(rect.x + 8, rect.y + rect.height - size * 1.8 - 8, width, size * 1.8);
	ctx.fillStyle = '#fff';
	ctx.fillText(label, rect.x + 8 + size / 2, rect.y + rect.height - size * 0.9 - 8, width - size);
}

export async function startMeetingRecording(options: {
	/** Called every frame, so people joining, leaving or turning cameras on show up as it happens. */
	getSources: () => CompositeSource[];
	micTrack: MediaStreamTrack | null;
	remoteAudioTracks: MediaStreamTrack[];
}): Promise<ActiveRecording> {
	const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
	if (!mimeType) throw new Error('Recording is not supported in this browser');

	// Before any await, so it counts as part of the click and doesn't start suspended.
	const context = new AudioContext();
	if (context.state === 'suspended') await context.resume().catch(() => undefined);

	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		await context.close();
		throw new Error('Canvas is not available');
	}

	// Our own video elements, fed straight from the tracks — independent of the call's tiles,
	// picture-in-picture, or whatever panel happens to cover them.
	const videos = new Map<string, HTMLVideoElement>();
	const videoFor = (track: MediaStreamTrack): HTMLVideoElement => {
		let video = videos.get(track.id);
		if (!video) {
			video = document.createElement('video');
			video.muted = true;
			video.playsInline = true;
			video.srcObject = new MediaStream([track]);
			void video.play().catch(() => undefined);
			videos.set(track.id, video);
		}
		return video;
	};

	const draw = () => {
		const sources = orderSources(options.getSources());
		const screens = sources.filter((source) => source.screen).length;
		const rects = layoutTiles(sources.length, screens);
		const live = new Set<string>();
		ctx.fillStyle = BACKGROUND;
		ctx.fillRect(0, 0, WIDTH, HEIGHT);
		sources.forEach((source, index) => {
			const rect = rects[index];
			const video = source.video?.readyState === 'live' ? videoFor(source.video) : null;
			if (source.video) live.add(source.video.id);
			ctx.save();
			ctx.beginPath();
			ctx.rect(rect.x, rect.y, rect.width, rect.height);
			ctx.clip();
			if (!video) {
				drawAvatar(ctx, source, rect);
			} else {
				ctx.fillStyle = '#000';
				ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
				// A camera's first few frames are still decoding: stay dark rather than flash initials.
				if (video.readyState >= 2 && video.videoWidth > 0) {
					const frame = fit(video.videoWidth, video.videoHeight, rect, source.screen ? 'contain' : 'cover');
					ctx.drawImage(video, frame.x, frame.y, frame.width, frame.height);
				}
			}
			ctx.restore();
			drawLabel(ctx, source.label, rect);
		});
		// Let go of tracks nobody shows any more (a camera turned off, someone who left).
		for (const [id, video] of videos) {
			if (!live.has(id)) {
				video.srcObject = null;
				videos.delete(id);
			}
		}
	};
	draw();
	const stopTicker = startTicker(draw);

	const mix = createAudioMix(context);
	if (options.micTrack) mix.add(options.micTrack);
	for (const track of options.remoteAudioTracks) mix.add(track);

	const canvasTrack = canvas.captureStream(FPS).getVideoTracks()[0];
	const stop = recordStream(new MediaStream([canvasTrack, mix.track]), mimeType, async () => {
		stopTicker();
		canvasTrack.stop();
		for (const video of videos.values()) video.srcObject = null;
		videos.clear();
		await context.close().catch(() => undefined);
	});

	return {
		mimeType,
		startedAt: new Date(),
		mixesRemoteAudio: true,
		addAudioTrack: mix.add,
		removeAudioTrack: mix.remove,
		stop
	};
}
