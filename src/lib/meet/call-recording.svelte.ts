import { Track, type Room } from 'livekit-client';
import { meetingRecordingSupported, startMeetingRecording } from './composite-recorder';
import { downloadBlob, recordingFilename, recordingSupported, startRecording, type ActiveRecording } from './recorder';
import { recordingChoices, type RecordingKind } from './recording-kind';
import { compositeSources, type RecordingLabels, type RecordingParticipant } from './recording-sources';

export type CallRecordingDeps = {
	/** The connected room, or `null` before and after. */
	room: () => Room | null;
	/** The public join code, which names the file. */
	meetingCode: () => string;
	/** This participant's display name, which the room does not carry for them. */
	localName: () => string;
	/** Read per frame, so a language change shows up in the next one. */
	labels: () => RecordingLabels & { guest: string };
	/** The `recording` attribute changed, so the roster everyone sees is stale. */
	onChange: () => void;
	notify: (key: 'meet.recordingSaved' | 'meet.recordingFailed') => void;
};

/**
 * This participant's own recording of the call: starting and stopping it,
 * keeping remote voices in the mix as people come and go, and what the header
 * and controls show while it runs. The recorders themselves live in
 * `recorder.ts` and `composite-recorder.ts`; this is the call-side state.
 */
export class CallRecording {
	// MediaRecorder + getDisplayMedia: desktop Chromium, Firefox and Safari; not phones.
	readonly canRecordView = typeof window !== 'undefined' && recordingSupported();
	readonly canRecordMeeting = typeof window !== 'undefined' && meetingRecordingSupported();

	active = $state(false);
	/** Which kind is running, for the header and for what everyone else is told. */
	kind = $state<RecordingKind>('view');
	saving = $state(false);
	elapsed = $state(0);
	/** Holds live media objects, so deliberately not reactive state. */
	private current: ActiveRecording | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly deps: CallRecordingDeps) {}

	/** What this participant may record here — see `recordingChoices`. */
	choices(isHost: boolean): RecordingKind[] {
		return recordingChoices({ isHost, meetingSupported: this.canRecordMeeting, viewSupported: this.canRecordView });
	}

	/** Self-reported to everyone else through the `recording` attribute: a consent notice, not a permission. */
	get attribute(): RecordingKind | null {
		return this.active ? this.kind : null;
	}

	async begin(kind: RecordingKind) {
		const room = this.deps.room();
		if (!room || this.current || this.saving) return;
		const micTrack = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack ?? null;
		try {
			this.current =
				kind === 'meeting'
					? await startMeetingRecording({ getSources: () => this.sources(), micTrack, remoteAudioTracks: this.remoteAudioTracks() })
					: await startRecording({ micTrack, remoteAudioTracks: this.remoteAudioTracks(), onEnded: () => void this.finish() });
		} catch (error) {
			// Closing the browser's picker is a choice, not a failure worth reporting.
			if (!(error instanceof DOMException && error.name === 'NotAllowedError')) this.deps.notify('meet.recordingFailed');
			return;
		}
		this.active = true;
		this.kind = kind;
		this.elapsed = 0;
		this.timer = setInterval(() => {
			if (this.current) this.elapsed = (Date.now() - this.current.startedAt.getTime()) / 1000;
		}, 1000);
		room.localParticipant.setAttributes({ recording: kind }).catch(() => {});
		this.deps.onChange();
	}

	/** Stops and saves. Safe to call when nothing is running, so every way out of a call can call it. */
	async finish() {
		const current = this.current;
		if (!current) return;
		this.current = null;
		this.active = false;
		this.saving = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		this.deps.room()?.localParticipant.setAttributes({ recording: '0' }).catch(() => {});
		this.deps.onChange();
		try {
			const blob = await current.stop();
			if (blob.size > 0) downloadBlob(blob, recordingFilename(this.deps.meetingCode(), current.startedAt, current.mimeType));
			this.deps.notify('meet.recordingSaved');
		} catch {
			this.deps.notify('meet.recordingFailed');
		} finally {
			this.saving = false;
		}
	}

	/** Someone who starts talking mid-recording has to join the mix too. */
	remoteAudioAdded(track: MediaStreamTrack) {
		if (this.current?.mixesRemoteAudio) this.current.addAudioTrack(track);
	}

	remoteAudioRemoved(track: MediaStreamTrack) {
		this.current?.removeAudioTrack(track);
	}

	/** A mic first turned on after recording started still belongs in it. */
	micPublished(track: MediaStreamTrack) {
		this.current?.addAudioTrack(track);
	}

	private remoteAudioTracks(): MediaStreamTrack[] {
		const room = this.deps.room();
		if (!room) return [];
		return Array.from(room.remoteParticipants.values()).flatMap((participant) =>
			Array.from(participant.audioTrackPublications.values()).flatMap((publication) =>
				publication.track ? [publication.track.mediaStreamTrack] : []
			)
		);
	}

	private sources() {
		const room = this.deps.room();
		if (!room) return [];
		const labels = this.deps.labels();
		const local = room.localParticipant;
		const participants: RecordingParticipant[] = [local, ...room.remoteParticipants.values()].map((participant) => {
			const camera = participant.getTrackPublication(Track.Source.Camera);
			const screen = participant.getTrackPublication(Track.Source.ScreenShare);
			return {
				identity: participant.identity,
				name: participant === local ? this.deps.localName() : participant.name || labels.guest,
				camera: camera?.track && !camera.isMuted ? camera.track.mediaStreamTrack : null,
				screen: screen?.track?.mediaStreamTrack ?? null
			};
		});
		return compositeSources(participants, labels);
	}
}
