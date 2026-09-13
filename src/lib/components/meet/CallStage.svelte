<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		Room,
		RoomEvent,
		Track,
		type LocalTrackPublication,
		type LocalVideoTrack,
		type Participant,
		type RemoteParticipant,
		type RemoteTrack,
		type RemoteTrackPublication,
		type TrackPublication
	} from 'livekit-client';
	import { BackgroundProcessor, supportsBackgroundProcessors } from '@livekit/track-processors';
	import { applyDeafenToggle, applyMicToggle } from '$lib/meet/av-state';
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import BackgroundPickerModal from '$lib/components/meet/BackgroundPickerModal.svelte';
	import CallParticipantsPanel from '$lib/components/meet/CallParticipantsPanel.svelte';
	import CallChatPanel from '$lib/components/meet/CallChatPanel.svelte';
	import CallSettingsPanel from '$lib/components/meet/CallSettingsPanel.svelte';
	import CallControls from '$lib/components/meet/CallControls.svelte';

	let {
		url,
		token,
		displayName,
		initialMicEnabled = true,
		initialCameraEnabled = true,
		initialMicDeviceId = '',
		initialCameraDeviceId = '',
		initialBackgroundOption = 'none',
		initialDeafened = false,
		isLoggedIn = false,
		meetingId = '',
		onleave
	}: {
		url: string;
		token: string;
		displayName: string;
		initialMicEnabled?: boolean;
		initialCameraEnabled?: boolean;
		initialMicDeviceId?: string;
		initialCameraDeviceId?: string;
		initialBackgroundOption?: string;
		initialDeafened?: boolean;
		isLoggedIn?: boolean;
		/** The meeting's internal id (LiveKit room name) — needed for the host-only settings/admissions endpoints. */
		meetingId?: string;
		onleave: () => void;
	} = $props();

	// getDisplayMedia has no mobile browser support (iOS/WebKit or Chrome
	// Android) as of 2026 — hide the control rather than fail silently on tap.
	const screenShareSupported =
		typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

	// setSinkId (routing audio to a chosen output device) is unsupported in
	// Safari as of 2026 — hide the speaker picker there rather than fail on tap.
	const speakerSelectionSupported =
		typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

	// Document Picture-in-Picture is Chromium-only as of 2026 (no Firefox/Safari
	// support) — hide the control rather than fail on tap. Where it's missing,
	// Chromium-based browsers still fall back to their own bare auto-PiP video
	// when the tab is hidden; this just gives Chromium users a real one with
	// working controls instead of that raw, control-less video.
	const pipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

	// Background blur/replacement needs WebAssembly + (ideally) Insertable
	// Streams; the library itself knows exactly what that requires per browser.
	const backgroundSupported = typeof navigator !== 'undefined' && supportsBackgroundProcessors();

	const CHAT_TOPIC = 'chat';

	let room: Room | null = null;
	let localMediaEl = $state<HTMLDivElement>();
	let remoteContainerEl = $state<HTMLDivElement>();
	let connecting = $state(true);
	let connectionError = $state('');
	let micEnabled = $state(untrack(() => initialMicEnabled));
	let cameraEnabled = $state(untrack(() => initialCameraEnabled));
	let micDeviceId = $state(untrack(() => initialMicDeviceId));
	let cameraDeviceId = $state(untrack(() => initialCameraDeviceId));
	let speakerDeviceId = $state('');
	// Listed at this level (rather than by DeviceSelect itself) because the speaker picker is
	// now bundled into the mic pill's popup as a plain option list, not its own DeviceSelect.
	let speakerDevices = $state<MediaDeviceInfo[]>([]);
	let backgroundOption = $state(untrack(() => initialBackgroundOption));
	let showBackgroundPicker = $state(false);
	let deafened = $state(untrack(() => initialDeafened));
	let micEnabledBeforeDeafen: boolean | null = null;
	let screenShareEnabled = $state(false);
	let remoteCount = $state(0);
	let localScreenMediaEl = $state<HTMLDivElement>();

	let pipWindow: Window | null = null;
	let pipActive = $state(false);
	let pipVideoEl: HTMLDivElement | null = null;
	let pipMicBtn: HTMLButtonElement | null = null;
	let pipCameraBtn: HTMLButtonElement | null = null;

	let isHost = $state(false);
	let requireApproval = $state(false);
	let settingsBusy = $state(false);
	let settingsError = $state('');
	let pendingAdmissions = $state<{ id: string; name: string }[]>([]);
	let admissionsBusyId = $state('');
	let admissionsPollTimer: ReturnType<typeof setInterval> | null = null;

	let panel = $state<'none' | 'participants' | 'chat' | 'settings'>('none');
	let roster = $state<{ identity: string; name: string; isLocal: boolean }[]>([]);
	let messages = $state<{ id: string; from: string; text: string; isLocal: boolean }[]>([]);
	let unread = $state(0);

	function initialsFor(name: string): string {
		return (
			name
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((part) => part[0]!.toUpperCase())
				.join('') || '?'
		);
	}

	/** A stable color per identity, so returning to a tile always looks the same. */
	function colorFor(seed: string): string {
		let hash = 0;
		for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
		return `hsl(${Math.abs(hash) % 360}, 45%, 38%)`;
	}

	const localInitials = $derived(initialsFor(displayName));
	const localColor = $derived(colorFor(displayName || 'me'));

	// A short beep synthesized on the fly — no audio asset to ship, and it works
	// the instant a call starts instead of waiting on a file to load.
	let soundCtx: AudioContext | null = null;

	function ensureSoundCtx(): AudioContext {
		if (!soundCtx) soundCtx = new AudioContext();
		if (soundCtx.state === 'suspended') void soundCtx.resume();
		return soundCtx;
	}

	function playTone(frequency: number, startOffset: number, duration = 0.09) {
		const ctx = ensureSoundCtx();
		const start = ctx.currentTime + startOffset;
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();
		oscillator.frequency.value = frequency;
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
		gain.gain.linearRampToValueAtTime(0, start + duration);
		oscillator.connect(gain);
		gain.connect(ctx.destination);
		oscillator.start(start);
		oscillator.stop(start + duration + 0.02);
	}

	function playJoinChime() {
		playTone(523.25, 0);
		playTone(659.25, 0.09);
	}

	function playLeaveChime() {
		playTone(659.25, 0);
		playTone(523.25, 0.09);
	}

	function playToggleTone(on: boolean) {
		playTone(on ? 880 : 440, 0, 0.08);
	}

	type Tile = {
		el: HTMLDivElement;
		media: HTMLDivElement;
		micIcon: HTMLElement;
		cameraIcon: HTMLElement;
		deafenedIcon: HTMLElement;
	};
	const remoteTiles = new Map<string, Tile>();
	const screenTiles = new Map<string, Tile>();

	function createTile(identity: string, label: string, extraClass = ''): Tile {
		const el = document.createElement('div');
		el.className = extraClass ? `call-tile ${extraClass}` : 'call-tile';

		const avatar = document.createElement('div');
		avatar.className = 'call-tile-avatar';
		avatar.style.background = colorFor(identity);
		avatar.textContent = initialsFor(label);

		const media = document.createElement('div');
		media.className = 'call-tile-media';

		const status = document.createElement('div');
		status.className = 'call-tile-status';
		const micIcon = document.createElement('i');
		micIcon.className = 'ri-mic-off-line call-tile-status-icon';
		micIcon.hidden = true;
		const cameraIcon = document.createElement('i');
		cameraIcon.className = 'ri-camera-off-line call-tile-status-icon';
		cameraIcon.hidden = true;
		const deafenedIcon = document.createElement('i');
		deafenedIcon.className = 'ri-volume-mute-line call-tile-status-icon';
		deafenedIcon.title = t('meet.deafenedStatus');
		deafenedIcon.hidden = true;
		status.append(micIcon, cameraIcon, deafenedIcon);

		const name = document.createElement('span');
		name.className = 'call-tile-name';
		name.textContent = label;

		el.append(avatar, media, status, name);
		return { el, media, micIcon, cameraIcon, deafenedIcon };
	}

	/** Reflects a participant's current mute state — and, via the `deafened` attribute, whether they've left audio — on their tile's status badges. */
	function updateTileStatus(tile: Tile, participant: Participant) {
		tile.micIcon.hidden = participant.isMicrophoneEnabled;
		tile.cameraIcon.hidden = participant.isCameraEnabled;
		tile.deafenedIcon.hidden = participant.attributes.deafened !== '1';
	}

	function ensureRemoteTile(participant: Participant): Tile {
		let tile = remoteTiles.get(participant.identity);
		if (!tile) {
			tile = createTile(participant.identity, participant.name || t('meet.guest'));
			remoteContainerEl?.appendChild(tile.el);
			remoteTiles.set(participant.identity, tile);
			remoteCount = remoteTiles.size;
		}
		updateTileStatus(tile, participant);
		return tile;
	}

	/**
	 * toggleMic/toggleCamera set micEnabled/cameraEnabled optimistically before the LiveKit call
	 * confirms it — if that call fails or races (a revoked permission, a device disappearing),
	 * the local tile's own icon can be left showing the wrong thing while every remote tile (which
	 * reads the real confirmed track state) shows the truth. Re-deriving from
	 * localParticipant.isMicrophoneEnabled/isCameraEnabled on every event that could change them
	 * keeps the local tile converged on the same ground truth remote tiles already use.
	 */
	function syncLocalAvState() {
		if (!room) return;
		micEnabled = room.localParticipant.isMicrophoneEnabled;
		cameraEnabled = room.localParticipant.isCameraEnabled;
	}

	function handleTrackMuteChanged(_publication: TrackPublication, participant: Participant) {
		if (room && participant === room.localParticipant) {
			syncLocalAvState();
			return;
		}
		const tile = remoteTiles.get(participant.identity);
		if (tile) updateTileStatus(tile, participant);
	}

	/** The `deafened` attribute (see toggleDeafen) is the only way another participant's tile can know they've left audio — there's no track for it. */
	function handleParticipantAttributesChanged(_changed: Record<string, string>, participant: Participant) {
		const tile = remoteTiles.get(participant.identity);
		if (tile) updateTileStatus(tile, participant);
	}

	function ensureScreenTile(participant: Participant): Tile {
		let tile = screenTiles.get(participant.identity);
		if (!tile) {
			tile = createTile(participant.identity, t('meet.screenShareOf', { name: participant.name || t('meet.guest') }), 'call-tile-screen');
			remoteContainerEl?.appendChild(tile.el);
			screenTiles.set(participant.identity, tile);
		}
		return tile;
	}

	function removeScreenTile(identity: string) {
		const tile = screenTiles.get(identity);
		if (tile) {
			tile.el.remove();
			screenTiles.delete(identity);
		}
	}

	/** Routes one attached remote element to the chosen output device, if a non-default one is picked. */
	function applySinkId(el: HTMLMediaElement) {
		if (!speakerSelectionSupported || !speakerDeviceId) return;
		void (el as HTMLMediaElement & { setSinkId(id: string): Promise<void> }).setSinkId(speakerDeviceId).catch(() => {
			// Device may have disappeared since selection — the default output still plays.
		});
	}

	function attachRemoteTrack(
		track: RemoteTrack,
		_publication: RemoteTrackPublication,
		participant: RemoteParticipant
	) {
		if (track.kind !== Track.Kind.Video && track.kind !== Track.Kind.Audio) return;
		if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) {
			const tile = ensureScreenTile(participant);
			const el = track.attach();
			applySinkId(el);
			if (track.kind === Track.Kind.Audio && deafened) el.muted = true;
			tile.media.appendChild(el);
			return;
		}
		const tile = ensureRemoteTile(participant);
		const el = track.attach();
		applySinkId(el);
		if (track.kind === Track.Kind.Audio && deafened) el.muted = true;
		tile.media.appendChild(el);
		if (pipActive && track.kind === Track.Kind.Video) refreshPipVideo();
	}

	function detachRemoteTrack(
		track: RemoteTrack,
		_publication: RemoteTrackPublication,
		participant: RemoteParticipant
	) {
		// The avatar layer sits behind the media layer, so emptying it (camera
		// off, or a full unpublish) is all it takes for the avatar to show again.
		for (const el of track.detach()) el.remove();
		// The screen tile has no avatar fallback, so it only makes sense while sharing.
		if (track.source === Track.Source.ScreenShare) removeScreenTile(participant.identity);
		if (pipActive && track.kind === Track.Kind.Video) refreshPipVideo();
	}

	function handleParticipantConnected(participant: RemoteParticipant) {
		playJoinChime();
		ensureRemoteTile(participant);
		refreshRoster();
	}

	function removeParticipantTile(participant: RemoteParticipant) {
		playLeaveChime();
		const tile = remoteTiles.get(participant.identity);
		if (tile) {
			tile.el.remove();
			remoteTiles.delete(participant.identity);
			remoteCount = remoteTiles.size;
		}
		removeScreenTile(participant.identity);
		refreshRoster();
	}

	function refreshRoster() {
		if (!room) return;
		const remote = Array.from(room.remoteParticipants.values()).map((p) => ({
			identity: p.identity,
			name: p.name || t('meet.guest'),
			isLocal: false
		}));
		roster = [{ identity: room.localParticipant.identity, name: displayName, isLocal: true }, ...remote];
		refreshPipVideo();
	}

	/**
	 * The PiP window shows whoever you're talking to, not yourself — falling
	 * back to your own camera only while waiting for someone else to join.
	 * Called on every roster/track change so it never goes stale while open.
	 */
	function refreshPipVideo() {
		if (!pipVideoEl || !room) return;
		pipVideoEl.innerHTML = '';
		const doc = pipVideoEl.ownerDocument;

		function showAvatar(name: string) {
			if (!pipVideoEl) return;
			const avatar = doc.createElement('div');
			avatar.className = 'pip-avatar';
			avatar.textContent = initialsFor(name);
			pipVideoEl.appendChild(avatar);
		}

		const remote = Array.from(room!.remoteParticipants.values())[0];
		if (remote) {
			const publication = Array.from(remote.videoTrackPublications.values()).find(
				(pub) => pub.track && pub.source !== Track.Source.ScreenShare
			);
			const track = publication?.track;
			if (track) {
				const el = track.attach();
				el.style.cssText = 'width:100%;height:100%;object-fit:cover;';
				pipVideoEl.appendChild(el);
			} else {
				showAvatar(remote.name || t('meet.guest'));
			}
			return;
		}

		if (cameraEnabled) {
			const publication = Array.from(room!.localParticipant.videoTrackPublications.values())[0];
			const track = publication?.track;
			if (track) {
				const el = track.attach();
				el.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';
				pipVideoEl.appendChild(el);
				return;
			}
		}
		showAvatar(displayName);
	}

	function updatePipButtons() {
		if (pipMicBtn) {
			pipMicBtn.textContent = micEnabled ? '🎤' : '🔇';
			pipMicBtn.classList.toggle('off', !micEnabled);
		}
		if (pipCameraBtn) {
			pipCameraBtn.textContent = cameraEnabled ? '🎥' : '🚫';
			pipCameraBtn.classList.toggle('off', !cameraEnabled);
		}
	}

	async function togglePip() {
		if (pipWindow) {
			pipWindow.close();
			return;
		}
		try {
			const win = await window.documentPictureInPicture!.requestWindow({ width: 300, height: 220 });
			pipWindow = win;
			pipActive = true;

			const style = win.document.createElement('style');
			style.textContent = `
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
			win.document.head.appendChild(style);

			const stage = win.document.createElement('div');
			stage.className = 'pip-stage';

			const videoWrap = win.document.createElement('div');
			videoWrap.className = 'pip-video';
			stage.appendChild(videoWrap);
			pipVideoEl = videoWrap;

			const controls = win.document.createElement('div');
			controls.className = 'pip-controls';

			const micBtn = win.document.createElement('button');
			micBtn.type = 'button';
			micBtn.className = 'pip-btn';
			micBtn.onclick = () => void toggleMic();
			controls.appendChild(micBtn);
			pipMicBtn = micBtn;

			const cameraBtn = win.document.createElement('button');
			cameraBtn.type = 'button';
			cameraBtn.className = 'pip-btn';
			cameraBtn.onclick = () => void toggleCamera();
			controls.appendChild(cameraBtn);
			pipCameraBtn = cameraBtn;

			const leaveBtn = win.document.createElement('button');
			leaveBtn.type = 'button';
			leaveBtn.className = 'pip-btn leave';
			leaveBtn.textContent = '✕';
			leaveBtn.onclick = () => leave();
			controls.appendChild(leaveBtn);

			stage.appendChild(controls);
			win.document.body.appendChild(stage);

			updatePipButtons();
			refreshPipVideo();

			win.addEventListener('pagehide', () => {
				pipWindow = null;
				pipActive = false;
				pipVideoEl = null;
				pipMicBtn = null;
				pipCameraBtn = null;
			});
		} catch {
			// Requires a user gesture and a secure context; if it's ever missing
			// despite the feature check, just leave the browser's own auto-PiP.
		}
	}

	function receiveChatMessage(text: string, identity: string) {
		const from = roster.find((p) => p.identity === identity)?.name || t('meet.guest');
		messages = [...messages, { id: crypto.randomUUID(), from, text, isLocal: false }];
		if (panel !== 'chat') unread += 1;
	}

	function handleLocalTrackPublished(publication: LocalTrackPublication) {
		// The camera track is unpublished (not just muted) when turned off, so this — not
		// TrackMuted — is what fires when it's turned back on; keep cameraEnabled converged either way.
		if (publication.source === Track.Source.Camera || publication.source === Track.Source.Microphone) {
			syncLocalAvState();
		}
		if (publication.source !== Track.Source.ScreenShare || !publication.track) return;
		screenShareEnabled = true;
		const el = publication.track.attach();
		localScreenMediaEl?.appendChild(el);
	}

	function handleLocalTrackUnpublished(publication: LocalTrackPublication) {
		if (publication.source === Track.Source.Camera || publication.source === Track.Source.Microphone) {
			syncLocalAvState();
		}
		if (publication.source !== Track.Source.ScreenShare) return;
		screenShareEnabled = false;
		if (localScreenMediaEl) localScreenMediaEl.innerHTML = '';
	}

	/**
	 * GPU delegate and a capped frame rate cut segmentation cost noticeably —
	 * the default (CPU delegate, 30fps) is what was causing visible lag.
	 * Re-applied to whatever the current camera track is on every camera
	 * (re)publish, since each publish is a fresh track.
	 */
	async function reapplyBackground() {
		if (!room || !backgroundSupported || backgroundOption === 'none') return;
		const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
			| LocalVideoTrack
			| undefined;
		if (!track) return;
		try {
			const common = { maxFps: 20, segmenterOptions: { delegate: 'GPU' as const } };
			if (backgroundOption === 'blur') {
				await track.setProcessor(BackgroundProcessor({ ...common, mode: 'background-blur', blurRadius: 10 }));
			} else {
				await track.setProcessor(
					BackgroundProcessor({ ...common, mode: 'virtual-background', imagePath: backgroundOption })
				);
			}
		} catch {
			// Segmentation model failed to load (offline, blocked CDN) — camera keeps working unprocessed.
		}
	}

	async function applyBackground(option: string) {
		backgroundOption = option;
		if (!room) return;
		const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
			| LocalVideoTrack
			| undefined;
		if (!track) return;
		if (option === 'none') {
			await track.stopProcessor();
			return;
		}
		await reapplyBackground();
	}

	// The PiP window's controls are hand-built DOM outside Svelte's reach, so
	// their state has to be pushed in imperatively whenever it changes.
	$effect(() => {
		micEnabled;
		cameraEnabled;
		if (pipActive) {
			updatePipButtons();
			refreshPipVideo();
		}
	});

	async function loadSpeakerDevices() {
		try {
			const all = await navigator.mediaDevices.enumerateDevices();
			speakerDevices = all.filter((device) => device.kind === 'audiooutput');
		} catch {
			speakerDevices = [];
		}
	}

	$effect(() => {
		if (!speakerSelectionSupported || !navigator.mediaDevices?.enumerateDevices) return;
		void loadSpeakerDevices();
		navigator.mediaDevices.addEventListener('devicechange', loadSpeakerDevices);
		return () => navigator.mediaDevices.removeEventListener('devicechange', loadSpeakerDevices);
	});

	onMount(() => {
		const instance = new Room();
		room = instance;

		instance.on(RoomEvent.TrackSubscribed, attachRemoteTrack);
		instance.on(RoomEvent.TrackUnsubscribed, detachRemoteTrack);
		instance.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
		instance.on(RoomEvent.ParticipantDisconnected, removeParticipantTile);
		instance.on(RoomEvent.Disconnected, onleave);
		instance.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
		instance.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
		instance.on(RoomEvent.TrackMuted, handleTrackMuteChanged);
		instance.on(RoomEvent.TrackUnmuted, handleTrackMuteChanged);
		instance.on(RoomEvent.ParticipantAttributesChanged, handleParticipantAttributesChanged);

		instance.registerTextStreamHandler(CHAT_TOPIC, async (reader, participantInfo) => {
			const text = await reader.readAll();
			receiveChatMessage(text, participantInfo.identity);
		});

		(async () => {
			try {
				await instance.connect(url, token);
				isHost = instance.localParticipant.attributes.role === 'host';
				if (isHost) void loadMeetingSettings();
				if (deafened) syncDeafenedAttribute('1');
				await instance.localParticipant.setMicrophoneEnabled(
					micEnabled,
					micDeviceId ? { deviceId: micDeviceId } : undefined
				);
				const cameraPublication = await instance.localParticipant.setCameraEnabled(
					cameraEnabled,
					cameraDeviceId ? { deviceId: cameraDeviceId } : undefined
				);
				const track = cameraPublication?.track;
				if (track) {
					const el = track.attach();
					el.muted = true;
					el.style.transform = 'scaleX(-1)';
					localMediaEl?.appendChild(el);
				}
				// A background may have been chosen before this first publish (from the lobby's popup).
				void reapplyBackground();
				for (const participant of instance.remoteParticipants.values()) ensureRemoteTile(participant);
				refreshRoster();
				playJoinChime();
			} catch (error) {
				connectionError = error instanceof Error ? error.message : t('meet.connectionError');
			} finally {
				connecting = false;
			}
		})();

		return () => {
			instance.off(RoomEvent.TrackSubscribed, attachRemoteTrack);
			instance.off(RoomEvent.TrackUnsubscribed, detachRemoteTrack);
			instance.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
			instance.off(RoomEvent.ParticipantDisconnected, removeParticipantTile);
			instance.off(RoomEvent.Disconnected, onleave);
			instance.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
			instance.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
			instance.off(RoomEvent.TrackMuted, handleTrackMuteChanged);
			instance.off(RoomEvent.TrackUnmuted, handleTrackMuteChanged);
			instance.off(RoomEvent.ParticipantAttributesChanged, handleParticipantAttributesChanged);
			instance.unregisterTextStreamHandler(CHAT_TOPIC);
		};
	});

	onDestroy(() => {
		room?.disconnect();
		pipWindow?.close();
		stopAdmissionsPolling();
		// Give the leave chime time to finish before the context that plays it dies.
		if (soundCtx) {
			const ctx = soundCtx;
			setTimeout(() => void ctx.close(), 300);
		}
	});

	async function toggleMic() {
		if (!room) return;
		const wasDeafened = deafened;
		({ micEnabled, deafened, micEnabledBeforeDeafen } = applyMicToggle({
			micEnabled,
			deafened,
			micEnabledBeforeDeafen
		}));
		if (wasDeafened && !deafened) {
			setRemoteAudioMuted(false);
			syncDeafenedAttribute('0');
		}
		playToggleTone(micEnabled);
		await room.localParticipant.setMicrophoneEnabled(micEnabled);
	}

	/**
	 * Broadcasts the deafened badge to other tiles — best-effort. This must never block the
	 * caller: a rejected setAttributes() (e.g. a dropped connection) would otherwise abort the
	 * rest of toggleDeafen/toggleMic and skip the actual mic/audio change.
	 */
	function syncDeafenedAttribute(value: '0' | '1') {
		if (!room) return;
		room.localParticipant.setAttributes({ deafened: value }).catch(() => {});
	}

	/** Mutes every currently-attached remote audio element — screen-share audio included. */
	function setRemoteAudioMuted(muted: boolean) {
		if (!room) return;
		for (const participant of room.remoteParticipants.values()) {
			for (const publication of participant.audioTrackPublications.values()) {
				for (const el of publication.track?.attachedElements ?? []) el.muted = muted;
			}
		}
	}

	/** "Leave audio" — both self-mute and stop hearing everyone else, like Discord's deafen or Zoom's leave audio. */
	async function toggleDeafen() {
		if (!room) return;
		const micWas = micEnabled;
		({ micEnabled, deafened, micEnabledBeforeDeafen } = applyDeafenToggle({
			micEnabled,
			deafened,
			micEnabledBeforeDeafen
		}));
		playToggleTone(!deafened);
		setRemoteAudioMuted(deafened);
		syncDeafenedAttribute(deafened ? '1' : '0');
		if (micEnabled !== micWas) await room.localParticipant.setMicrophoneEnabled(micEnabled);
	}

	async function toggleCamera() {
		if (!room) return;
		cameraEnabled = !cameraEnabled;
		playToggleTone(cameraEnabled);
		if (cameraEnabled) {
			const publication = await room.localParticipant.setCameraEnabled(
				true,
				cameraDeviceId ? { deviceId: cameraDeviceId } : undefined
			);
			const track = publication?.track;
			if (track && localMediaEl) {
				localMediaEl.innerHTML = '';
				const el = track.attach();
				el.muted = true;
				el.style.transform = 'scaleX(-1)';
				localMediaEl.appendChild(el);
			}
			void reapplyBackground();
		} else {
			await room.localParticipant.setCameraEnabled(false);
			if (localMediaEl) localMediaEl.innerHTML = '';
		}
	}

	async function selectMic(id: string) {
		micDeviceId = id;
		if (room) await room.switchActiveDevice('audioinput', id);
	}

	async function selectCamera(id: string) {
		cameraDeviceId = id;
		if (room) await room.switchActiveDevice('videoinput', id);
	}

	function selectSpeaker(id: string) {
		speakerDeviceId = id;
		if (!room) return;
		for (const participant of room.remoteParticipants.values()) {
			for (const publication of [...participant.audioTrackPublications.values(), ...participant.videoTrackPublications.values()]) {
				for (const el of publication.track?.attachedElements ?? []) applySinkId(el);
			}
		}
	}

	async function toggleScreenShare() {
		if (!room) return;
		try {
			// LiveKit shows the browser's own screen/window picker and, if the user
			// cancels it, rejects here without ever publishing — nothing to undo.
			await room.localParticipant.setScreenShareEnabled(!screenShareEnabled, { audio: true });
		} catch {
			// Picker dismissed or permission denied; state already reflects "off".
		}
	}

	function togglePanel(next: 'participants' | 'chat' | 'settings') {
		panel = panel === next ? 'none' : next;
		if (panel === 'chat') unread = 0;
	}

	async function sendChatMessage(text: string) {
		if (!room) return;
		messages = [...messages, { id: crypto.randomUUID(), from: displayName, text, isLocal: true }];
		try {
			await room.localParticipant.sendText(text, { topic: CHAT_TOPIC });
		} catch {
			// The message still shows locally; a dropped send isn't worth blocking the call over.
		}
	}

	async function loadMeetingSettings() {
		if (!meetingId) return;
		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`);
			const body = (await response.json().catch(() => ({}))) as {
				meeting?: { require_approval: boolean };
			};
			if (response.ok && body.meeting) {
				requireApproval = body.meeting.require_approval;
				if (requireApproval) startAdmissionsPolling();
			}
		} catch {
			// The settings panel just shows the last-known (default) value — not worth surfacing an error for.
		}
	}

	async function setAdmissionMode(next: boolean) {
		if (!meetingId || settingsBusy) return;
		settingsBusy = true;
		settingsError = '';
		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ requireApproval: next })
			});
			if (!response.ok) {
				settingsError = t('meetings.couldNotSave');
				return;
			}
			requireApproval = next;
			if (next) startAdmissionsPolling();
			else stopAdmissionsPolling();
		} catch {
			settingsError = t('common.networkError');
		} finally {
			settingsBusy = false;
		}
	}

	function startAdmissionsPolling() {
		if (admissionsPollTimer || !meetingId) return;
		const check = async () => {
			try {
				const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/admissions`);
				const body = (await response.json().catch(() => ({}))) as {
					admissions?: { id: string; name: string }[];
				};
				if (response.ok && body.admissions) pendingAdmissions = body.admissions;
			} catch {
				// A dropped poll just retries on the next tick.
			}
		};
		void check();
		admissionsPollTimer = setInterval(() => void check(), 4000);
	}

	function stopAdmissionsPolling() {
		if (admissionsPollTimer) clearInterval(admissionsPollTimer);
		admissionsPollTimer = null;
		pendingAdmissions = [];
	}

	async function respondToAdmission(admissionId: string, action: 'admit' | 'deny') {
		if (!meetingId || admissionsBusyId) return;
		admissionsBusyId = admissionId;
		try {
			await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/admissions/${encodeURIComponent(admissionId)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			pendingAdmissions = pendingAdmissions.filter((admission) => admission.id !== admissionId);
		} catch {
			settingsError = t('common.networkError');
		} finally {
			admissionsBusyId = '';
		}
	}

	function leave() {
		playLeaveChime();
		stopAdmissionsPolling();
		room?.disconnect();
		onleave();
	}
</script>

<div class="call-stage">
	<div class="call-header">
		<span class="call-header-name">{displayName}</span>
		{#if connecting}
			<span class="call-header-status">{t('meet.connecting')}</span>
		{:else if connectionError}
			<span class="call-header-status call-header-status-error">{connectionError}</span>
		{/if}
	</div>

	<div class="call-body">
		<div class="call-grid">
			<div class="call-tile call-tile-screen" hidden={!screenShareEnabled}>
				<div class="call-tile-media" bind:this={localScreenMediaEl}></div>
				<span class="call-tile-name">{t('meet.you')} · {t('meet.screenShare')}</span>
			</div>
			<div class="call-tile call-tile-local">
				<div class="call-tile-avatar" style="background: {localColor}">{localInitials}</div>
				<div class="call-tile-media" bind:this={localMediaEl}></div>
				<div class="call-tile-status">
					{#if !micEnabled}<Icon name="mic-off-line" size={14} class="call-tile-status-icon" />{/if}
					{#if !cameraEnabled}<Icon name="camera-off-line" size={14} class="call-tile-status-icon" />{/if}
					{#if deafened}<Icon name="volume-mute-line" size={14} class="call-tile-status-icon" />{/if}
				</div>
				<span class="call-tile-name">{displayName} · {t('meet.you')}</span>
			</div>
			<div class="call-tile-group" bind:this={remoteContainerEl}></div>
			{#if !connecting && !connectionError && remoteCount === 0}
				<div class="call-tile call-tile-placeholder">
					<span>{t('meet.waitingForOthers')}</span>
				</div>
			{/if}
		</div>

		{#if panel === 'participants'}
			<CallParticipantsPanel {roster} onClose={() => (panel = 'none')} />
		{:else if panel === 'chat'}
			<CallChatPanel {messages} onSend={sendChatMessage} onClose={() => (panel = 'none')} />
		{:else if panel === 'settings'}
			<CallSettingsPanel
				{requireApproval}
				{settingsBusy}
				{settingsError}
				{pendingAdmissions}
				{admissionsBusyId}
				onSetAdmissionMode={setAdmissionMode}
				onRespondToAdmission={respondToAdmission}
				onClose={() => (panel = 'none')}
			/>
		{/if}
	</div>

	<CallControls
		{deafened}
		{micEnabled}
		{micDeviceId}
		{cameraEnabled}
		{cameraDeviceId}
		{speakerDeviceId}
		{speakerDevices}
		{speakerSelectionSupported}
		{backgroundSupported}
		{backgroundOption}
		{screenShareSupported}
		{screenShareEnabled}
		{pipSupported}
		{pipActive}
		{panel}
		rosterCount={roster.length}
		{unread}
		{isHost}
		pendingAdmissionsCount={pendingAdmissions.length}
		onToggleDeafen={toggleDeafen}
		onSelectMic={selectMic}
		onToggleMic={toggleMic}
		onSelectSpeaker={selectSpeaker}
		onSelectCamera={selectCamera}
		onToggleCamera={toggleCamera}
		onShowBackgroundPicker={() => (showBackgroundPicker = true)}
		onToggleScreenShare={toggleScreenShare}
		onTogglePip={togglePip}
		onTogglePanel={togglePanel}
		onLeave={leave}
	/>
</div>

{#if showBackgroundPicker}
	<BackgroundPickerModal
		{cameraDeviceId}
		initialOption={backgroundOption}
		{isLoggedIn}
		onapply={(option) => void applyBackground(option)}
		onclose={() => (showBackgroundPicker = false)}
	/>
{/if}

<style>
	.call-stage {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		height: 100%;
		min-height: 100dvh;
		padding: 1rem;
		background: #0b0b0d;
		color: #fff;
		box-sizing: border-box;
	}

	.call-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0 0.25rem;
	}

	.call-header-name {
		font-size: 0.9rem;
		font-weight: 600;
	}

	.call-header-status {
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.6);
	}

	.call-header-status-error {
		color: #f87171;
	}

	.call-body {
		flex: 1;
		display: flex;
		gap: 0.75rem;
		min-height: 0;
	}

	.call-grid {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
		align-content: start;
		min-width: 0;
	}

	/*
	 * Remote tiles are created with document.createElement, not written in this
	 * component's template — Svelte never sees them, so it never tags them with
	 * its scoping class. Every rule a tile needs must be :global() or it silently
	 * no-ops on remote participants (a mobile camera's portrait video then renders
	 * at its native size with nothing constraining it).
	 */
	:global(.call-tile) {
		position: relative;
		aspect-ratio: 16 / 9;
		width: 100%;
		border-radius: 0.75rem;
		background: #1c1c1f;
		overflow: hidden;
	}

	:global(.call-tile-avatar) {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.9);
	}

	:global(.call-tile-media) {
		position: relative;
		width: 100%;
		height: 100%;
	}

	:global(.call-tile-media video) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	:global(.call-tile-name) {
		position: absolute;
		left: 0.5rem;
		bottom: 0.5rem;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		max-width: calc(100% - 1rem);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.call-tile-screen) {
		grid-column: 1 / -1;
		aspect-ratio: 16 / 9;
		max-height: 65vh;
		background: #000;
	}

	:global(.call-tile-screen .call-tile-media video) {
		object-fit: contain;
	}

	:global(.call-tile-status) {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		gap: 0.25rem;
	}

	:global(.call-tile-status-icon) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		color: #f87171;
	}

	:global(.call-tile-placeholder) {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 1rem;
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.5);
		border: 1px dashed rgba(255, 255, 255, 0.15);
		background: transparent;
	}

	.call-tile-group {
		display: contents;
	}

	@media (max-width: 640px) {
		.call-body {
			flex-direction: column;
		}
	}
</style>
