import { Track, type Room } from 'livekit-client';
import { initialsFor } from './avatar';

export type CallPipDeps = {
	/** The connected room, or `null` before and after. */
	room: () => Room | null;
	/** This participant's display name, for their own avatar when nobody else is in the call. */
	localName: () => string;
	micEnabled: () => boolean;
	cameraEnabled: () => boolean;
	/** What a remote participant without a name is called. */
	guestLabel: () => string;
	onToggleMic: () => void;
	onToggleCamera: () => void;
	onLeave: () => void;
};

/** The PiP window is a separate document, so its styles travel with it. */
const PIP_STYLE = `
	:root { color-scheme: dark; }
	body { margin: 0; background: #0b0b0d; overflow: hidden; font-family: system-ui, sans-serif; }
	.pip-stage { display: flex; flex-direction: column; width: 100%; height: 100vh; }
	.pip-video { flex: 1; min-height: 0; background: #1c1c1f; display: flex; align-items: center; justify-content: center; }
	.pip-video video { width: 100%; height: 100%; object-fit: cover; }
	.pip-avatar { font-size: 1.5rem; font-weight: 600; color: rgba(255,255,255,0.85); }
	.pip-controls { flex-shrink: 0; height: 44px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: #0b0b0d; }
	.pip-btn { width: 32px; height: 32px; border: none; border-radius: 999px; background: #3f3f46; color: #fff; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center; padding: 0; }
	.pip-btn.off { background: #dc2626; }
	.pip-btn.leave { background: #dc2626; }
`;

/**
 * The call's picture-in-picture window: a small document of our own with the
 * other side's video and mic/camera/leave buttons. Its DOM is hand-built and
 * outside Svelte's reach, so CallStage pushes state in through `refreshVideo`
 * and `updateButtons` whenever tracks or toggles change.
 *
 * Document Picture-in-Picture is Chromium-only as of 2026 (no Firefox/Safari
 * support): where it is missing the control is hidden rather than failing on
 * tap, and Chromium-based browsers still fall back to their own bare auto-PiP
 * video when the tab is hidden. This just gives Chromium users a real one
 * with working controls instead of that raw, control-less video.
 */
export class CallPictureInPicture {
	readonly supported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
	active = $state(false);
	private win: Window | null = null;
	private videoEl: HTMLDivElement | null = null;
	private micBtn: HTMLButtonElement | null = null;
	private cameraBtn: HTMLButtonElement | null = null;

	constructor(private readonly deps: CallPipDeps) {}

	close() {
		this.win?.close();
	}

	async toggle() {
		if (this.win) {
			this.win.close();
			return;
		}
		try {
			const win = await window.documentPictureInPicture!.requestWindow({ width: 300, height: 220 });
			this.win = win;
			this.active = true;
			this.build(win);
			this.updateButtons();
			this.refreshVideo();
			win.addEventListener('pagehide', () => {
				this.win = null;
				this.active = false;
				this.videoEl = null;
				this.micBtn = null;
				this.cameraBtn = null;
			});
		} catch {
			// Requires a user gesture and a secure context; if it's ever missing
			// despite the feature check, just leave the browser's own auto-PiP.
		}
	}

	private build(win: Window) {
		const doc = win.document;
		const style = doc.createElement('style');
		style.textContent = PIP_STYLE;
		doc.head.appendChild(style);

		const stage = doc.createElement('div');
		stage.className = 'pip-stage';

		const videoWrap = doc.createElement('div');
		videoWrap.className = 'pip-video';
		stage.appendChild(videoWrap);
		this.videoEl = videoWrap;

		const controls = doc.createElement('div');
		controls.className = 'pip-controls';
		this.micBtn = this.button(doc, 'pip-btn', () => this.deps.onToggleMic());
		this.cameraBtn = this.button(doc, 'pip-btn', () => this.deps.onToggleCamera());
		const leaveBtn = this.button(doc, 'pip-btn leave', () => this.deps.onLeave());
		leaveBtn.textContent = '✕';
		controls.append(this.micBtn, this.cameraBtn, leaveBtn);

		stage.appendChild(controls);
		doc.body.appendChild(stage);
	}

	private button(doc: Document, className: string, onclick: () => void): HTMLButtonElement {
		const button = doc.createElement('button');
		button.type = 'button';
		button.className = className;
		button.onclick = onclick;
		return button;
	}

	/**
	 * The PiP window shows whoever you're talking to, not yourself — falling
	 * back to your own camera, then initials, when nobody else is in the call.
	 */
	refreshVideo() {
		const room = this.deps.room();
		const videoEl = this.videoEl;
		if (!videoEl || !room) return;
		videoEl.innerHTML = '';
		const doc = videoEl.ownerDocument;

		const showAvatar = (name: string) => {
			const avatar = doc.createElement('div');
			avatar.className = 'pip-avatar';
			avatar.textContent = initialsFor(name);
			videoEl.appendChild(avatar);
		};

		const remote = Array.from(room.remoteParticipants.values())[0];
		if (remote) {
			const publication = Array.from(remote.videoTrackPublications.values()).find(
				(pub) => pub.track && pub.source !== Track.Source.ScreenShare
			);
			const track = publication?.track;
			if (track) {
				const el = track.attach();
				el.style.cssText = 'width:100%;height:100%;object-fit:cover;';
				videoEl.appendChild(el);
			} else {
				showAvatar(remote.name || this.deps.guestLabel());
			}
			return;
		}

		if (this.deps.cameraEnabled()) {
			const publication = Array.from(room.localParticipant.videoTrackPublications.values())[0];
			const track = publication?.track;
			if (track) {
				const el = track.attach();
				el.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';
				videoEl.appendChild(el);
				return;
			}
		}
		showAvatar(this.deps.localName());
	}

	updateButtons() {
		const micEnabled = this.deps.micEnabled();
		const cameraEnabled = this.deps.cameraEnabled();
		if (this.micBtn) {
			this.micBtn.textContent = micEnabled ? '🎤' : '🔇';
			this.micBtn.classList.toggle('off', !micEnabled);
		}
		if (this.cameraBtn) {
			this.cameraBtn.textContent = cameraEnabled ? '🎥' : '🚫';
			this.cameraBtn.classList.toggle('off', !cameraEnabled);
		}
	}
}
