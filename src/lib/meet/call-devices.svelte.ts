import type { Room } from 'livekit-client';

export type CallDevicesDeps = {
	/** The connected room, or `null` before and after. */
	room: () => Room | null;
	/** The mic's underlying track was replaced, so anything capturing it should follow. */
	onMicChanged: () => void;
};

type SinkableElement = HTMLMediaElement & { setSinkId(id: string): Promise<void> };

/**
 * Which microphone, camera and speaker the call uses. The mic and camera ids
 * are handed to LiveKit when a track is (re)published; the speaker id is
 * applied to every attached element, since output routing is per element.
 * Construct it while the component initialises: it watches for devices coming
 * and going.
 */
export class CallDevices {
	// setSinkId (routing audio to a chosen output device) is unsupported in
	// Safari as of 2026 — hide the speaker picker there rather than fail on tap.
	readonly speakerSelectionSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

	micId = $state('');
	cameraId = $state('');
	speakerId = $state('');
	// Listed here (rather than by DeviceSelect itself) because the speaker picker is
	// bundled into the mic pill's popup as a plain option list, not its own DeviceSelect.
	speakers = $state<MediaDeviceInfo[]>([]);

	constructor(
		private readonly deps: CallDevicesDeps,
		initial: { micId: string; cameraId: string }
	) {
		this.micId = initial.micId;
		this.cameraId = initial.cameraId;

		$effect(() => {
			if (!this.speakerSelectionSupported || !navigator.mediaDevices?.enumerateDevices) return;
			const load = () => void this.loadSpeakers();
			load();
			navigator.mediaDevices.addEventListener('devicechange', load);
			return () => navigator.mediaDevices.removeEventListener('devicechange', load);
		});
	}

	/** The constraint for publishing a track from the chosen device; `undefined` leaves it to the browser. */
	micConstraint(): { deviceId: string } | undefined {
		return this.micId ? { deviceId: this.micId } : undefined;
	}

	cameraConstraint(): { deviceId: string } | undefined {
		return this.cameraId ? { deviceId: this.cameraId } : undefined;
	}

	/** Routes an element's audio to the chosen speaker, when there is one. */
	applySinkId(el: HTMLMediaElement) {
		if (!this.speakerSelectionSupported || !this.speakerId) return;
		void (el as SinkableElement).setSinkId(this.speakerId).catch(() => {
			// Device may have disappeared since selection — the default output still plays.
		});
	}

	async selectMic(id: string) {
		this.micId = id;
		await this.deps.room()?.switchActiveDevice('audioinput', id);
		this.deps.onMicChanged();
	}

	async selectCamera(id: string) {
		this.cameraId = id;
		await this.deps.room()?.switchActiveDevice('videoinput', id);
	}

	selectSpeaker(id: string) {
		this.speakerId = id;
		const room = this.deps.room();
		if (!room) return;
		for (const participant of room.remoteParticipants.values()) {
			for (const publication of [...participant.audioTrackPublications.values(), ...participant.videoTrackPublications.values()]) {
				for (const el of publication.track?.attachedElements ?? []) this.applySinkId(el);
			}
		}
	}

	private async loadSpeakers() {
		try {
			const all = await navigator.mediaDevices.enumerateDevices();
			this.speakers = all.filter((device) => device.kind === 'audiooutput');
		} catch {
			this.speakers = [];
		}
	}
}
