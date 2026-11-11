import { untrack } from 'svelte';
import { Track, type Room } from 'livekit-client';
import { captionCaptureSupported, startCaptionCapture } from './caption-capture';
import { CAPTION_LANGUAGE_STORAGE_KEY, captionLanguage } from './caption-language';
import {
	CAPTIONS_ALLOWED_ATTRIBUTE,
	CAPTIONS_WANTED_ATTRIBUTE,
	CAPTION_TOPIC,
	createCaptionUploader,
	livePartials,
	parseCaptionMessage,
	recentCaptions,
	transcriptFile,
	type CaptionLine,
	type CaptionPartial,
	type CaptionStopReason
} from './captions';
import { downloadBlob } from './recorder';

const MAX_CAPTION_LINES = 2_000;

export type CallCaptionsDeps = {
	/** The connected room, or `null` before and after. */
	room: () => Room | null;
	/** True once connected: attributes are only worth setting then. */
	ready: () => boolean;
	meetingCode: () => string;
	/** Lets this participant have their own speech transcribed; empty when they can't. */
	captionToken: () => string;
	localName: () => string;
	isHost: () => boolean;
	micEnabled: () => boolean;
	/** The transcript panel is open, which wants captions as much as the strip does. */
	transcriptOpen: () => boolean;
	/** Anyone in the roster (this participant included) asking for captions. */
	someoneWants: () => boolean;
	/** A participant's name as the roster knows it; `undefined` for someone unknown. */
	nameOf: (identity: string) => string | undefined;
	guestLabel: () => string;
	notify: (key: 'meet.captionsHostDisabled' | 'meet.captionsPaused') => void;
	/** This participant's `wantsCaptions` attribute changed, so the roster is stale. */
	onWantedChanged: () => void;
};

/**
 * Captions for the call: whether the host allows them, this viewer's strip and
 * the transcript, what each speaker is saying right now, and this
 * participant's own capture while anyone is listening. Construct it while the
 * component initialises: it runs its own effects.
 */
export class CallCaptions {
	// Declared first: the derived fields below read it, and field initialisers run before the constructor body.
	private readonly deps: CallCaptionsDeps;
	readonly canCaption = typeof window !== 'undefined' && captionCaptureSupported();

	allowed = $state(false);
	/** This viewer's own captions strip; turning it on affects nobody else's screen. */
	on = $state(false);
	lines = $state<CaptionLine[]>([]);
	/** Set once the Worker refuses: out of allowance, captions turned off, or a bad token. */
	stopped = $state(false);
	/** Words still being spoken, one per speaker, until their line replaces them. */
	partials = $state<CaptionPartial[]>([]);
	/** The language this participant speaks, for their own captions; `''` lets Whisper guess. */
	spokenLanguage = $state('');
	private clock = $state(Date.now());
	/** Bumped whenever the mic's underlying track may have been replaced, so capture follows it. */
	private micTrackVersion = $state(0);

	// Getters rather than `$derived` fields: a field initialiser would read `deps` before the constructor sets it.
	/** This viewer wants captions: the strip is on, or the transcript is open. */
	get wants(): boolean {
		return this.allowed && (this.on || this.deps.transcriptOpen());
	}

	get someoneWants(): boolean {
		return this.allowed && this.deps.someoneWants();
	}

	/** Whether this participant's own speech is being captured right now. */
	get transcribing(): boolean {
		return (
			this.someoneWants &&
			this.deps.micEnabled() &&
			!this.stopped &&
			this.canCaption &&
			Boolean(this.deps.captionToken() && this.deps.meetingCode())
		);
	}

	get shownPartials(): CaptionPartial[] {
		return livePartials(this.partials, this.clock);
	}

	/** The last few lines for the strip, leaving room for what is still being said. */
	get shown(): CaptionLine[] {
		return this.on ? recentCaptions(this.lines, this.clock, undefined, Math.max(1, 3 - this.shownPartials.length)) : [];
	}

	constructor(deps: CallCaptionsDeps, initial: { allowed: boolean; transcript: CaptionLine[] }) {
		this.deps = deps;
		this.allowed = initial.allowed;
		this.lines = initial.transcript;
		this.spokenLanguage = loadSpokenLanguage();

		// Speakers only transcribe while someone has captions or the transcript open.
		$effect(() => {
			const wanted = this.wants;
			if (!this.deps.ready()) return;
			const room = this.deps.room();
			if (!room) return;
			room.localParticipant.setAttributes({ [CAPTIONS_WANTED_ATTRIBUTE]: wanted ? '1' : '' }).catch(() => {});
			untrack(() => this.deps.onWantedChanged());
		});

		$effect(() => {
			if (!this.transcribing) return;
			void this.micTrackVersion;
			return this.capture();
		});

		// Captions fade a few seconds after they're spoken, and a stranded partial expires, so both need a clock.
		$effect(() => {
			if (!this.wants) return;
			const timer = setInterval(() => (this.clock = Date.now()), 1000);
			return () => clearInterval(timer);
		});
	}

	toggle() {
		this.on = !this.on;
	}

	setSpokenLanguage(code: string) {
		this.spokenLanguage = captionLanguage(code);
		try {
			localStorage.setItem(CAPTION_LANGUAGE_STORAGE_KEY, this.spokenLanguage);
		} catch {
			// Private mode: the choice lasts for this call only.
		}
	}

	/** The mic track may have been replaced (turned on, or switched), so capture should follow it. */
	micTrackChanged() {
		this.micTrackVersion += 1;
	}

	/** The host's setting, as loaded or as the host just broadcast it. */
	applyAllowed(next: boolean) {
		if (next === this.allowed) return;
		if (!next && !this.deps.isHost() && this.wants) this.deps.notify('meet.captionsHostDisabled');
		this.allowed = next;
		if (next) this.stopped = false;
		else this.on = false;
	}

	/** The host re-broadcasts the setting as an attribute, so a mid-call change reaches everyone. */
	broadcastAllowed() {
		const room = this.deps.room();
		if (!room || !this.deps.isHost()) return;
		room.localParticipant.setAttributes({ [CAPTIONS_ALLOWED_ATTRIBUTE]: this.allowed ? '1' : '0' }).catch(() => {});
	}

	receive(raw: string, identity: string) {
		const message = parseCaptionMessage(raw);
		if (!message) return;
		if (message.type === 'paused') {
			if (this.wants) this.deps.notify('meet.captionsPaused');
			return;
		}
		const name = this.deps.nameOf(identity) || this.deps.guestLabel();
		if (message.type === 'partial') this.setPartial(identity, name, message.text);
		else this.addLine(identity, name, message.text);
	}

	download(format: 'txt' | 'vtt') {
		if (this.lines.length === 0) return;
		const { blob, filename } = transcriptFile(this.lines, this.deps.meetingCode(), format);
		downloadBlob(blob, filename);
	}

	/** A speaker's partial is replaced by the next one, and taken down by their line or an empty one. */
	private setPartial(identity: string, name: string, text: string) {
		const at = Date.now();
		const others = this.partials.filter((partial) => partial.identity !== identity);
		this.partials = text ? [...others, { identity, name, text, at }] : others;
		this.clock = at;
	}

	private addLine(identity: string, name: string, text: string) {
		const at = Date.now();
		this.lines = [...this.lines.slice(1 - MAX_CAPTION_LINES), { id: crypto.randomUUID(), identity, name, text, at }];
		this.setPartial(identity, name, '');
	}

	private publishOwnLine(text: string) {
		const room = this.deps.room();
		if (!room) return;
		this.addLine(room.localParticipant.identity, this.deps.localName(), text);
		room.localParticipant.sendText(JSON.stringify({ type: 'line', text }), { topic: CAPTION_TOPIC }).catch(() => {});
	}

	private publishOwnPartial(text: string) {
		const room = this.deps.room();
		if (!room) return;
		this.setPartial(room.localParticipant.identity, this.deps.localName(), text);
		room.localParticipant.sendText(JSON.stringify({ type: 'partial', text }), { topic: CAPTION_TOPIC }).catch(() => {});
	}

	/** Out of allowance is everyone's business, since it stops every speaker; the rest only stop this one. */
	private stop(reason: CaptionStopReason) {
		this.stopped = true;
		const room = this.deps.room();
		if (reason !== 'limit' || !room) return;
		this.deps.notify('meet.captionsPaused');
		room.localParticipant.sendText(JSON.stringify({ type: 'paused' }), { topic: CAPTION_TOPIC }).catch(() => {});
	}

	/** Starts capturing this participant's mic; returns what stops it. */
	private capture(): (() => void) | undefined {
		const track = this.deps.room()?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
		if (!track) return undefined;
		const uploader = createCaptionUploader({
			code: this.deps.meetingCode(),
			token: this.deps.captionToken(),
			fetch: (input, init) => fetch(input, init),
			onText: (text) => this.publishOwnLine(text),
			onPartial: (text) => this.publishOwnPartial(text),
			onStop: (reason) => this.stop(reason),
			language: () => this.spokenLanguage
		});
		let stopCapture: (() => void) | null = null;
		let cancelled = false;
		startCaptionCapture(
			track,
			(wav) => uploader.send(wav),
			(wav) => uploader.sendPartial(wav)
		)
			.then((stopper) => {
				if (cancelled) stopper();
				else stopCapture = stopper;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			stopCapture?.();
		};
	}
}

function loadSpokenLanguage(): string {
	try {
		return captionLanguage(localStorage.getItem(CAPTION_LANGUAGE_STORAGE_KEY));
	} catch {
		return '';
	}
}
