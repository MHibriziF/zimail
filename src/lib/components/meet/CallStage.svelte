<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		DisconnectReason,
		Room,
		RoomEvent,
		Track,
		createLocalScreenTracks,
		type LocalTrack,
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
	import { deviceErrorKey } from '$lib/meet/device-errors';
	import { takeUnseenAdmissions } from '$lib/meet/admission-alerts';
	import { normalizeDisplayName } from '$lib/meet/display-name';
	import { isHostIdentity } from '$lib/meet/host-identity';
	import { formatElapsed } from '$lib/meet/recorder';
	import { CallRecording } from '$lib/meet/call-recording.svelte';
	import { colorFor, initialsFor } from '$lib/meet/avatar';
	import { CallPictureInPicture } from '$lib/meet/call-pip.svelte';
	import { CallLayout } from '$lib/meet/call-layout.svelte';
	import { parseRecordingAttribute, type RecordingKind } from '$lib/meet/recording-kind';
	import { cooldownSecondsLeft, createRequestChimeGate } from '$lib/meet/share-request-throttle';
	import {
		DEFAULT_SCREEN_SHARE,
		parseScreenShareMode,
		parseScreenSharePolicy,
		pickFeaturedShare,
		shouldYieldScreenShare,
		type ScreenShareMode,
		type ScreenSharePolicy,
		type ScreenShareSettings
	} from '$lib/meet/screen-share';
	import { HAND_ATTRIBUTE, HAND_NOTICE_WINDOW_MS, parseHandRaisedAt } from '$lib/meet/raised-hands';
	import { createReactionLimiter, isReaction, pushCapped, type Reaction } from '$lib/meet/reactions';
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import BackgroundPickerModal from '$lib/components/meet/BackgroundPickerModal.svelte';
	import CallParticipantsPanel from '$lib/components/meet/CallParticipantsPanel.svelte';
	import CallChatPanel from '$lib/components/meet/CallChatPanel.svelte';
	import CallSettingsPanel from '$lib/components/meet/CallSettingsPanel.svelte';
	import CallControls from '$lib/components/meet/CallControls.svelte';
	import CallTranscriptPanel from '$lib/components/meet/CallTranscriptPanel.svelte';
	import { CAPTIONS_ALLOWED_ATTRIBUTE, CAPTIONS_WANTED_ATTRIBUTE, CAPTION_TOPIC, type CaptionLine } from '$lib/meet/captions';
	import { CallCaptions } from '$lib/meet/call-captions.svelte';
	import { CallDevices } from '$lib/meet/call-devices.svelte';

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
		meetingCode = '',
		initialScreenShare = DEFAULT_SCREEN_SHARE,
		initialCaptionsAllowed = false,
		captionToken = '',
		initialTranscript = [],
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
		/** The public join code — only used to name a recording. */
		meetingCode?: string;
		/** As of joining — the host's attributes carry any change made after that. */
		initialScreenShare?: ScreenShareSettings;
		/** As of joining, like the screen-share settings. */
		initialCaptionsAllowed?: boolean;
		/** Lets this participant have their own speech transcribed for the whole call. */
		captionToken?: string;
		/** From before a rejoin, so leaving and coming back doesn't lose it. */
		initialTranscript?: CaptionLine[];
		/** Gets the call's transcript, so the page can still offer it once the call is gone. */
		/** `ended` when the host closed the call for everyone; `deleted` when they also deleted the meeting. */
		onleave: (transcript: CaptionLine[], reason?: 'left' | 'ended' | 'deleted') => void;
	} = $props();

	// getDisplayMedia has no mobile browser support (iOS/WebKit or Chrome
	// Android) as of 2026 — hide the control rather than fail silently on tap.
	const screenShareSupported =
		typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

	// Background blur/replacement needs WebAssembly + (ideally) Insertable
	// Streams; the library itself knows exactly what that requires per browser.
	const backgroundSupported = typeof navigator !== 'undefined' && supportsBackgroundProcessors();

	const CHAT_TOPIC = 'chat';
	const SCREEN_SHARE_REQUEST_TOPIC = 'screen-share-request';
	const SCREEN_SHARE_DECLINED_TOPIC = 'screen-share-declined';
	const SCREEN_SHARE_CANCELLED_TOPIC = 'screen-share-cancelled';
	const REACTION_TOPIC = 'reaction';
	/** Long enough for the float-up animation to finish before the element goes. */
	const REACTION_DURATION_MS = 3000;
	/** `TrackSource.SCREEN_SHARE` in LiveKit's protocol — livekit-client doesn't re-export the enum. */
	const PROTO_SCREEN_SHARE_SOURCE = 3;
	/** Stands in for your own share in `shareOrder`, where everyone else is keyed by identity. */
	const LOCAL_SHARE_KEY = 'local';

	let room: Room | null = null;
	let localMediaEl = $state<HTMLDivElement>();
	let remoteContainerEl = $state<HTMLDivElement>();
	const layout = new CallLayout();
	let connecting = $state(true);
	let connectionError = $state('');
	/** Until connect() settles: a Disconnected event then means it failed, not that the call ended. */
	let awaitingConnect = false;
	let micEnabled = $state(untrack(() => initialMicEnabled));
	let cameraEnabled = $state(untrack(() => initialCameraEnabled));
	const devices = new CallDevices(
		{ room: () => room, onMicChanged: () => captions.micTrackChanged() },
		{ micId: untrack(() => initialMicDeviceId), cameraId: untrack(() => initialCameraDeviceId) }
	);
	let backgroundOption = $state(untrack(() => initialBackgroundOption));
	let showBackgroundPicker = $state(false);
	let deafened = $state(untrack(() => initialDeafened));
	let micEnabledBeforeDeafen: boolean | null = null;
	let screenShareEnabled = $state(false);
	let remoteCount = $state(0);
	let localScreenMediaEl = $state<HTMLDivElement>();

	const pip = new CallPictureInPicture({
		room: () => room,
		localName: () => localName,
		micEnabled: () => micEnabled,
		cameraEnabled: () => cameraEnabled,
		guestLabel: () => t('meet.guest'),
		onToggleMic: () => void toggleMic(),
		onToggleCamera: () => void toggleCamera(),
		onLeave: () => void leave()
	});

	let isHost = $state(false);
	let requireApproval = $state(false);
	let settingsBusy = $state(false);
	let settingsError = $state('');
	let pendingAdmissions = $state<{ id: string; name: string }[]>([]);
	let admissionsBusyId = $state('');
	let admissionsPollTimer: ReturnType<typeof setInterval> | null = null;
	const ringedAdmissionIds = new Set<string>();

	let screenShareSettings = $state<ScreenShareSettings>(untrack(() => ({ ...initialScreenShare })));
	let canShareScreen = $state(true);
	let screenShareRequested = $state(false);
	/**
	 * Under "only people I allow", the screen is picked *before* asking, so
	 * approval can start sharing straight away — no second press, and the
	 * browser's picker (which needs a click) never has to open later.
	 */
	let pendingScreenTracks: LocalTrack[] = [];
	let screenShareRequests = $state<{ identity: string; name: string }[]>([]);
	let screenShareBusyIdentity = $state('');
	/** Seconds left before a declined requester may ask again; 0 means the button is free. */
	let shareCooldownSeconds = $state(0);
	let shareCooldownTimer: ReturnType<typeof setInterval> | null = null;
	const requestChimeGate = createRequestChimeGate();
	/** Active shares, oldest first. */
	let shareOrder = $state<string[]>([]);
	/** A share the viewer clicked to watch instead of the newest. */
	let pinnedShare = $state<string | null>(null);
	const featuredShare = $derived(pickFeaturedShare(shareOrder, pinnedShare, LOCAL_SHARE_KEY));
	let ownShareStartedAt = 0;
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;

	const recorder = new CallRecording({
		room: () => room,
		meetingCode: () => meetingCode,
		localName: () => localName,
		labels: () => ({ guest: t('meet.guest'), screenShareOf: (name) => t('meet.screenShareOf', { name }) }),
		onChange: () => refreshRoster(),
		notify: (key) => showNotice(t(key))
	});

	let handRaisedAt = $state<number | null>(null);
	const handNoticeGate = createRequestChimeGate(HAND_NOTICE_WINDOW_MS);
	let floatingReactions = $state<{ id: string; emoji: Reaction; name: string; left: number }[]>([]);
	let reactionsShown = 0;
	const reactionLimiter = createReactionLimiter();
	const LOCAL_REACTION_KEY = 'local';

	let panel = $state<'none' | 'participants' | 'chat' | 'settings' | 'transcript'>('none');
	let roster = $state<
		{
			identity: string;
			name: string;
			isLocal: boolean;
			isHost: boolean;
			canShareScreen: boolean;
			/** Self-reported through the `recording` attribute — a consent notice, not a permission. */
			recording: RecordingKind | null;
			handRaisedAt: number | null;
			wantsCaptions: boolean;
		}[]
	>([]);
	const othersRecording = $derived(
		roster.filter((entry) => !entry.isLocal && entry.recording !== null)
	);
	const raisedHandCount = $derived(roster.filter((entry) => entry.handRaisedAt !== null).length);
	let messages = $state<{ id: string; from: string; text: string; isLocal: boolean; isHost: boolean }[]>([]);
	let unread = $state(0);

	const captions = new CallCaptions(
		{
			room: () => room,
			ready: () => !connecting && !connectionError,
			meetingCode: () => meetingCode,
			captionToken: () => captionToken,
			localName: () => localName,
			isHost: () => isHost,
			micEnabled: () => micEnabled,
			transcriptOpen: () => panel === 'transcript',
			someoneWants: () => roster.some((entry) => entry.wantsCaptions),
			nameOf: (identity) => roster.find((entry) => entry.identity === identity)?.name,
			guestLabel: () => t('meet.guest'),
			notify: (key) => showNotice(t(key)),
			onWantedChanged: () => refreshRoster()
		},
		{ allowed: untrack(() => initialCaptionsAllowed), transcript: untrack(() => initialTranscript) }
	);

	let localName = $state(untrack(() => displayName));
	const localInitials = $derived(initialsFor(localName));
	// Seeded from the join-time name, not localName, so renaming doesn't also repaint your avatar.
	const localColor = colorFor(untrack(() => displayName) || 'me');

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

	/** Three rising notes — distinct from the two-note join chime, since it asks the host to act. */
	function playAdmissionChime() {
		playTone(783.99, 0, 0.12);
		playTone(987.77, 0.13, 0.12);
		playTone(1174.66, 0.26, 0.18);
	}

	type Tile = {
		el: HTMLDivElement;
		avatar: HTMLDivElement;
		nameEl: HTMLSpanElement;
		media: HTMLDivElement;
		micIcon: HTMLElement;
		cameraIcon: HTMLElement;
		deafenedIcon: HTMLElement;
		handIcon: HTMLElement;
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

		const handIcon = document.createElement('i');
		handIcon.className = 'ri-hand call-tile-hand';
		handIcon.title = t('meet.handRaised');
		handIcon.hidden = true;

		// The label is its own span so renaming can replace the text without
		// touching the host badge beside it.
		const nameRow = document.createElement('span');
		nameRow.className = 'call-tile-name';
		const name = document.createElement('span');
		name.className = 'call-tile-label';
		name.textContent = label;
		nameRow.append(name);
		if (isHostIdentity(identity)) {
			const badge = document.createElement('span');
			badge.className = 'call-host-badge';
			badge.textContent = t('meet.hostBadge');
			nameRow.append(badge);
		}

		el.append(avatar, media, status, handIcon, nameRow);
		return { el, avatar, nameEl: name, media, micIcon, cameraIcon, deafenedIcon, handIcon };
	}

	function handleParticipantNameChanged(_name: string, participant: Participant) {
		if (room && participant === room.localParticipant) return;
		const label = participant.name || t('meet.guest');
		const tile = remoteTiles.get(participant.identity);
		if (tile) {
			tile.nameEl.textContent = label;
			tile.avatar.textContent = initialsFor(label);
		}
		const screenTile = screenTiles.get(participant.identity);
		if (screenTile) screenTile.nameEl.textContent = t('meet.screenShareOf', { name: label });
		refreshRoster();
	}

	/** Returns an error message for the rename form, or '' on success. */
	async function renameSelf(input: string): Promise<string> {
		const name = normalizeDisplayName(input);
		if (!name) return t('meet.renameEmpty');
		if (!room) return t('meet.connectionError');
		try {
			await room.localParticipant.setName(name);
		} catch {
			return t('meet.renameFailed');
		}
		localName = name;
		refreshRoster();
		return '';
	}

	/** Reflects a participant's current mute state — and, via the `deafened` attribute, whether they've left audio — on their tile's status badges. */
	function updateTileStatus(tile: Tile, participant: Participant) {
		tile.micIcon.hidden = participant.isMicrophoneEnabled;
		tile.cameraIcon.hidden = participant.isCameraEnabled;
		tile.deafenedIcon.hidden = participant.attributes.deafened !== '1';
		const handRaised = parseHandRaisedAt(participant.attributes[HAND_ATTRIBUTE]) !== null;
		tile.handIcon.hidden = !handRaised;
		tile.el.classList.toggle('call-tile-hand-raised', handRaised);
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
	function handleParticipantAttributesChanged(changed: Record<string, string>, participant: Participant) {
		const tile = remoteTiles.get(participant.identity);
		if (tile) updateTileStatus(tile, participant);
		if (room && participant !== room.localParticipant) {
			readHostSettings(participant);
			if (HAND_ATTRIBUTE in changed) announceRaisedHand(participant, changed[HAND_ATTRIBUTE]);
		}
		refreshRoster();
	}

	/** Once per raise, and not again for a while — lowering and raising in a loop can't spam everyone. */
	function announceRaisedHand(participant: Participant, value: string | undefined) {
		if (parseHandRaisedAt(value) === null) return;
		if (!handNoticeGate.shouldRing(participant.identity, Date.now())) return;
		showNotice(t('meet.handRaisedBy', { name: participant.name || t('meet.guest') }));
	}

	function ensureScreenTile(participant: Participant): Tile {
		let tile = screenTiles.get(participant.identity);
		if (!tile) {
			const identity = participant.identity;
			tile = createTile(identity, t('meet.screenShareOf', { name: participant.name || t('meet.guest') }), 'call-tile-screen');
			tile.el.tabIndex = 0;
			tile.el.setAttribute('role', 'button');
			tile.el.title = t('meet.focusScreenShare');
			tile.el.addEventListener('click', () => focusShare(identity));
			tile.el.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					focusShare(identity);
				}
			});
			remoteContainerEl?.appendChild(tile.el);
			screenTiles.set(identity, tile);
		}
		return tile;
	}

	function removeScreenTile(identity: string) {
		const tile = screenTiles.get(identity);
		if (tile) {
			tile.el.remove();
			screenTiles.delete(identity);
		}
		removeShare(identity);
	}

	/** A new share always takes the big tile — newest first, per the host's "several at once" rule. */
	function addShare(key: string) {
		if (shareOrder.includes(key)) return;
		shareOrder = [...shareOrder, key];
		pinnedShare = null;
	}

	function removeShare(key: string) {
		shareOrder = shareOrder.filter((entry) => entry !== key);
	}

	function focusShare(key: string) {
		pinnedShare = key;
	}

	// Remote tiles are hand-built DOM, so the featured class has to be pushed onto them.
	$effect(() => {
		const featured = featuredShare;
		shareOrder;
		for (const [identity, tile] of screenTiles) {
			const isFeatured = identity === featured;
			tile.el.classList.toggle('call-tile-featured', isFeatured);
			tile.el.setAttribute('aria-pressed', String(isFeatured));
		}
	});

	/** Routes one attached remote element to the chosen output device, if a non-default one is picked. */
	function attachRemoteTrack(
		track: RemoteTrack,
		_publication: RemoteTrackPublication,
		participant: RemoteParticipant
	) {
		if (track.kind !== Track.Kind.Video && track.kind !== Track.Kind.Audio) return;
		if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) {
			const tile = ensureScreenTile(participant);
			const el = track.attach();
			devices.applySinkId(el);
			if (track.kind === Track.Kind.Audio && deafened) el.muted = true;
			tile.media.appendChild(el);
			if (track.source === Track.Source.ScreenShare) addShare(participant.identity);
			return;
		}
		const tile = ensureRemoteTile(participant);
		const el = track.attach();
		devices.applySinkId(el);
		if (track.kind === Track.Kind.Audio && deafened) el.muted = true;
		tile.media.appendChild(el);
		if (track.kind === Track.Kind.Audio) recorder.remoteAudioAdded(track.mediaStreamTrack);
		if (pip.active && track.kind === Track.Kind.Video) pip.refreshVideo();
	}

	function detachRemoteTrack(
		track: RemoteTrack,
		_publication: RemoteTrackPublication,
		participant: RemoteParticipant
	) {
		// The avatar layer sits behind the media layer, so emptying it (camera
		// off, or a full unpublish) is all it takes for the avatar to show again.
		for (const el of track.detach()) el.remove();
		if (track.kind === Track.Kind.Audio) recorder.remoteAudioRemoved(track.mediaStreamTrack);
		// The screen tile has no avatar fallback, so it only makes sense while sharing.
		if (track.source === Track.Source.ScreenShare) removeScreenTile(participant.identity);
		if (pip.active && track.kind === Track.Kind.Video) pip.refreshVideo();
	}

	function handleParticipantConnected(participant: RemoteParticipant) {
		playJoinChime();
		ensureRemoteTile(participant);
		readHostSettings(participant);
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
		requestChimeGate.forget(participant.identity);
		handNoticeGate.forget(participant.identity);
		reactionLimiter.forget(participant.identity);
		screenShareRequests = screenShareRequests.filter((request) => request.identity !== participant.identity);
		refreshRoster();
	}

	function refreshRoster() {
		if (!room) return;
		const remote = Array.from(room.remoteParticipants.values()).map((p) => ({
			identity: p.identity,
			name: p.name || t('meet.guest'),
			isLocal: false,
			isHost: isHostIdentity(p.identity),
			canShareScreen: mayShareScreen(p),
			recording: parseRecordingAttribute(p.attributes.recording),
			handRaisedAt: parseHandRaisedAt(p.attributes[HAND_ATTRIBUTE]),
			wantsCaptions: p.attributes[CAPTIONS_WANTED_ATTRIBUTE] === '1'
		}));
		roster = [
			{
				identity: room.localParticipant.identity,
				name: localName,
				isLocal: true,
				isHost: isHostIdentity(room.localParticipant.identity),
				canShareScreen,
				recording: recorder.attribute,
				handRaisedAt,
				wantsCaptions: captions.wants
			},
			...remote
		];
		pip.refreshVideo();
	}

	/** An empty source list is LiveKit's "no restriction". */
	function mayShareScreen(participant: Participant): boolean {
		const sources = participant.permissions?.canPublishSources ?? [];
		return sources.length === 0 || sources.includes(PROTO_SCREEN_SHARE_SOURCE);
	}

	function showNotice(text: string) {
		notice = text;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = ''), 6000);
	}

	function handlePermissionsChanged(_previous: unknown, participant: Participant) {
		if (room && participant === room.localParticipant) {
			const couldShare = canShareScreen;
			canShareScreen = mayShareScreen(participant);
			// Being allowed outright settles whatever the earlier decline was about.
			if (canShareScreen) stopShareCooldown();
			if (canShareScreen && !couldShare && screenShareRequested) void publishPendingScreenShare();
			if (!canShareScreen && screenShareEnabled) {
				void room.localParticipant.setScreenShareEnabled(false).catch(() => {});
			}
		}
		refreshRoster();
	}

	/**
	 * Host-side backstop for "one at a time". The previous sharer's own client
	 * steps aside below, but that is cooperative — only the host can ask the
	 * server to mute a client that doesn't.
	 */
	async function enforceSingleShare(newIdentity: string) {
		if (!isHost || !meetingId) return;
		const stale = shareOrder.filter((key) => key !== newIdentity && key !== LOCAL_SHARE_KEY);
		await Promise.all(
			stale.map((identity) =>
				fetch(`/api/meetings/${encodeURIComponent(meetingId)}/screen-share/stop`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ identity })
				}).catch(() => {})
			)
		);
	}

	/** "One at a time": someone else just started sharing, so ours makes way. */
	function handleRemoteTrackPublished(publication: RemoteTrackPublication, participant: RemoteParticipant) {
		if (publication.source !== Track.Source.ScreenShare || !room) return;
		if (screenShareSettings.mode !== 'single') return;
		void enforceSingleShare(participant.identity);
		if (!screenShareEnabled) return;
		const yields = shouldYieldScreenShare({
			ownStartedAt: ownShareStartedAt,
			now: Date.now(),
			ownIdentity: room.localParticipant.identity,
			otherIdentity: participant.identity
		});
		if (!yields) return;
		void room.localParticipant.setScreenShareEnabled(false).catch(() => {});
		showNotice(t('meet.screenShareReplaced', { name: participant.name || t('meet.guest') }));
	}

	/**
	 * The host re-broadcasts the meeting's screen-share and captions settings as its own attributes,
	 * so a change made mid-call reaches everyone without another server round trip.
	 */
	function readHostSettings(participant: Participant) {
		if (!isHostIdentity(participant.identity)) return;
		const allowed = participant.attributes[CAPTIONS_ALLOWED_ATTRIBUTE];
		if (allowed === '1' || allowed === '0') captions.applyAllowed(allowed === '1');
		const policy = parseScreenSharePolicy(participant.attributes.screenSharePolicy);
		const mode = parseScreenShareMode(participant.attributes.screenShareMode);
		if (policy || mode) applyScreenShareSettings({ policy: policy ?? screenShareSettings.policy, mode: mode ?? screenShareSettings.mode });
	}

	function applyScreenShareSettings(next: ScreenShareSettings) {
		screenShareSettings = next;
		// Switching to "one at a time" mid-call: everyone but the newest sharer stops.
		const ownIndex = shareOrder.indexOf(LOCAL_SHARE_KEY);
		if (next.mode === 'single' && room && ownIndex !== -1 && ownIndex < shareOrder.length - 1) {
			void room.localParticipant.setScreenShareEnabled(false).catch(() => {});
		}
	}

	function receiveChatMessage(text: string, identity: string) {
		const from = roster.find((p) => p.identity === identity)?.name || t('meet.guest');
		messages = [
			...messages,
			{ id: crypto.randomUUID(), from, text, isLocal: false, isHost: isHostIdentity(identity) }
		];
		if (panel !== 'chat') unread += 1;
	}

	function handleLocalTrackPublished(publication: LocalTrackPublication) {
		// The camera track is unpublished (not just muted) when turned off, so this — not
		// TrackMuted — is what fires when it's turned back on; keep cameraEnabled converged either way.
		if (publication.source === Track.Source.Camera || publication.source === Track.Source.Microphone) {
			syncLocalAvState();
		}
		if (publication.source === Track.Source.Microphone && publication.track) {
			recorder.micPublished(publication.track.mediaStreamTrack);
			captions.micTrackChanged();
		}
		if (publication.source !== Track.Source.ScreenShare || !publication.track) return;
		screenShareEnabled = true;
		ownShareStartedAt = Date.now();
		addShare(LOCAL_SHARE_KEY);
		const el = publication.track.attach();
		localScreenMediaEl?.appendChild(el);
	}

	function handleLocalTrackUnpublished(publication: LocalTrackPublication) {
		if (publication.source === Track.Source.Camera || publication.source === Track.Source.Microphone) {
			syncLocalAvState();
		}
		if (publication.source !== Track.Source.ScreenShare) return;
		screenShareEnabled = false;
		removeShare(LOCAL_SHARE_KEY);
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
		if (pip.active) {
			pip.updateButtons();
			pip.refreshVideo();
		}
	});

	async function connectToRoom(instance: Room) {
		connecting = true;
		connectionError = '';
		awaitingConnect = true;
		try {
			await instance.connect(url, token);
			awaitingConnect = false;
			isHost = isHostIdentity(instance.localParticipant.identity);
			if (isHost) void loadMeetingSettings();
			if (deafened) syncDeafenedAttribute('1');
			if (handRaisedAt !== null) syncHandAttribute();
			canShareScreen = mayShareScreen(instance.localParticipant);
			// Who's already here shows while our own devices are still starting.
			for (const participant of instance.remoteParticipants.values()) {
				ensureRemoteTile(participant);
				readHostSettings(participant);
			}
			refreshRoster();
			// Read both choices first: publishing the mic re-syncs cameraEnabled from LiveKit,
			// which reports it off until the camera is published too.
			const wantMic = micEnabled;
			const wantCamera = cameraEnabled;
			// A device that won't start is the caller's to fix, not a failed connection.
			if (wantMic) await enableMic();
			if (wantCamera) await enableCamera();
			playJoinChime();
		} catch (error) {
			connectionError = error instanceof Error ? error.message : t('meet.connectionError');
		} finally {
			awaitingConnect = false;
			connecting = false;
		}
	}

	/** A failed connect fires Disconnected too; that one stays on the stage as an error with Retry. */
	function handleDisconnected(reason?: DisconnectReason) {
		if (awaitingConnect || endingMeeting) return;
		onleave(captions.lines, reason === DisconnectReason.ROOM_DELETED ? 'ended' : 'left');
	}

	function retryConnect() {
		if (room && !connecting) void connectToRoom(room);
	}

	onMount(() => {
		const instance = new Room();
		room = instance;

		instance.on(RoomEvent.TrackSubscribed, attachRemoteTrack);
		instance.on(RoomEvent.TrackUnsubscribed, detachRemoteTrack);
		instance.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
		instance.on(RoomEvent.ParticipantDisconnected, removeParticipantTile);
		instance.on(RoomEvent.Disconnected, handleDisconnected);
		instance.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
		instance.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
		instance.on(RoomEvent.TrackMuted, handleTrackMuteChanged);
		instance.on(RoomEvent.TrackUnmuted, handleTrackMuteChanged);
		instance.on(RoomEvent.ParticipantAttributesChanged, handleParticipantAttributesChanged);
		instance.on(RoomEvent.ParticipantNameChanged, handleParticipantNameChanged);
		instance.on(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
		instance.on(RoomEvent.TrackPublished, handleRemoteTrackPublished);

		instance.registerTextStreamHandler(CHAT_TOPIC, async (reader, participantInfo) => {
			const text = await reader.readAll();
			receiveChatMessage(text, participantInfo.identity);
		});
		instance.registerTextStreamHandler(SCREEN_SHARE_REQUEST_TOPIC, async (reader, participantInfo) => {
			await reader.readAll();
			receiveScreenShareRequest(participantInfo.identity);
		});
		instance.registerTextStreamHandler(SCREEN_SHARE_DECLINED_TOPIC, async (reader, participantInfo) => {
			await reader.readAll();
			// Only a host's answer counts — anyone could send on this topic.
			if (!isHostIdentity(participantInfo.identity) || !screenShareRequested) return;
			releasePendingScreenShare();
			startShareCooldown();
			showNotice(t('meet.screenShareDeclined'));
		});
		instance.registerTextStreamHandler(REACTION_TOPIC, async (reader, participantInfo) => {
			receiveReaction(await reader.readAll(), participantInfo.identity);
		});
		instance.registerTextStreamHandler(CAPTION_TOPIC, async (reader, participantInfo) => {
			captions.receive(await reader.readAll(), participantInfo.identity);
		});
		instance.registerTextStreamHandler(SCREEN_SHARE_CANCELLED_TOPIC, async (reader, participantInfo) => {
			await reader.readAll();
			screenShareRequests = screenShareRequests.filter((request) => request.identity !== participantInfo.identity);
		});

		void connectToRoom(instance);

		return () => {
			instance.off(RoomEvent.TrackSubscribed, attachRemoteTrack);
			instance.off(RoomEvent.TrackUnsubscribed, detachRemoteTrack);
			instance.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
			instance.off(RoomEvent.ParticipantDisconnected, removeParticipantTile);
			instance.off(RoomEvent.Disconnected, handleDisconnected);
			instance.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
			instance.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
			instance.off(RoomEvent.TrackMuted, handleTrackMuteChanged);
			instance.off(RoomEvent.TrackUnmuted, handleTrackMuteChanged);
			instance.off(RoomEvent.ParticipantAttributesChanged, handleParticipantAttributesChanged);
			instance.off(RoomEvent.ParticipantNameChanged, handleParticipantNameChanged);
			instance.off(RoomEvent.ParticipantPermissionsChanged, handlePermissionsChanged);
			instance.off(RoomEvent.TrackPublished, handleRemoteTrackPublished);
			instance.unregisterTextStreamHandler(CHAT_TOPIC);
			instance.unregisterTextStreamHandler(SCREEN_SHARE_REQUEST_TOPIC);
			instance.unregisterTextStreamHandler(SCREEN_SHARE_DECLINED_TOPIC);
			instance.unregisterTextStreamHandler(SCREEN_SHARE_CANCELLED_TOPIC);
			instance.unregisterTextStreamHandler(REACTION_TOPIC);
			instance.unregisterTextStreamHandler(CAPTION_TOPIC);
		};
	});

	onDestroy(() => {
		// However the call ends — Leave, a dropped connection, closing the page — keep what was recorded.
		void recorder.finish();
		room?.disconnect();
		pip.close();
		stopAdmissionsPolling();
		releasePendingScreenShare();
		stopShareCooldown();
		if (noticeTimer) clearTimeout(noticeTimer);
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
		if (micEnabled) await enableMic();
		else await room.localParticipant.setMicrophoneEnabled(false);
	}

	/** Turns the mic on, or explains why it can't be and shows it as off. */
	async function enableMic() {
		if (!room) return;
		try {
			await room.localParticipant.setMicrophoneEnabled(true, devices.micConstraint());
		} catch (error) {
			micEnabled = false;
			showNotice(t(deviceErrorKey(error)));
		}
	}

	/** Turns the camera on, or explains why it can't be and shows it as off. */
	async function enableCamera() {
		if (!room) return;
		try {
			const publication = await room.localParticipant.setCameraEnabled(
				true,
				devices.cameraConstraint()
			);
			const track = publication?.track;
			if (track && localMediaEl) {
				localMediaEl.innerHTML = '';
				const el = track.attach();
				el.muted = true;
				el.style.transform = 'scaleX(-1)';
				localMediaEl.appendChild(el);
			}
			// A background may have been chosen before this publish (from the lobby's popup).
			void reapplyBackground();
		} catch (error) {
			cameraEnabled = false;
			showNotice(t(deviceErrorKey(error)));
		}
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

	function syncHandAttribute() {
		if (!room) return;
		room.localParticipant
			.setAttributes({ [HAND_ATTRIBUTE]: handRaisedAt === null ? '' : String(handRaisedAt) })
			.catch(() => {});
	}

	function toggleHand() {
		handRaisedAt = handRaisedAt === null ? Date.now() : null;
		syncHandAttribute();
		refreshRoster();
	}

	/** Ctrl+Alt+H, unless typing — AltGr is Ctrl+Alt on some layouts, so it can arrive mid-word. */
	function handleShortcut(event: KeyboardEvent) {
		if (!event.ctrlKey || !event.altKey || event.code !== 'KeyH') return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"]')) return;
		event.preventDefault();
		toggleHand();
	}

	function showReaction(emoji: Reaction, name: string) {
		const id = crypto.randomUUID();
		// Spread across the lower-left corner so a burst doesn't stack into one glyph.
		const left = 1 + ((reactionsShown++ * 3.5) % 17.5);
		floatingReactions = pushCapped(floatingReactions, { id, emoji, name, left });
		setTimeout(() => {
			floatingReactions = floatingReactions.filter((reaction) => reaction.id !== id);
		}, REACTION_DURATION_MS);
	}

	function sendReaction(emoji: Reaction) {
		if (!room || !reactionLimiter.allow(LOCAL_REACTION_KEY, Date.now())) return;
		showReaction(emoji, localName);
		room.localParticipant.sendText(emoji, { topic: REACTION_TOPIC }).catch(() => {});
	}

	function receiveReaction(text: string, identity: string) {
		if (!room || !isReaction(text) || !reactionLimiter.allow(identity, Date.now())) return;
		showReaction(text, room.remoteParticipants.get(identity)?.name || t('meet.guest'));
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
		if (micEnabled === micWas) return;
		if (micEnabled) await enableMic();
		else await room.localParticipant.setMicrophoneEnabled(false);
	}

	async function toggleCamera() {
		if (!room) return;
		cameraEnabled = !cameraEnabled;
		playToggleTone(cameraEnabled);
		if (cameraEnabled) {
			await enableCamera();
		} else {
			await room.localParticipant.setCameraEnabled(false);
			if (localMediaEl) localMediaEl.innerHTML = '';
		}
	}

	async function toggleScreenShare() {
		if (!room) return;
		if (screenShareRequested) {
			void cancelScreenShareRequest();
			return;
		}
		if (!screenShareEnabled && !canShareScreen) {
			await requestScreenShare();
			return;
		}
		try {
			// LiveKit shows the browser's own screen/window picker and, if the user
			// cancels it, rejects here without ever publishing — nothing to undo.
			await room.localParticipant.setScreenShareEnabled(!screenShareEnabled, { audio: true });
		} catch {
			// Picker dismissed or permission denied; state already reflects "off".
		}
	}

	/** Ticks the countdown down to 0, then stops itself and frees the button. */
	function startShareCooldown() {
		const declinedAt = Date.now();
		shareCooldownSeconds = cooldownSecondsLeft(declinedAt, declinedAt);
		if (shareCooldownTimer) clearInterval(shareCooldownTimer);
		shareCooldownTimer = setInterval(() => {
			shareCooldownSeconds = cooldownSecondsLeft(declinedAt, Date.now());
			if (shareCooldownSeconds === 0) stopShareCooldown();
		}, 1000);
	}

	function stopShareCooldown() {
		if (shareCooldownTimer) clearInterval(shareCooldownTimer);
		shareCooldownTimer = null;
		shareCooldownSeconds = 0;
	}

	function hostIdentities(): string[] {
		if (!room) return [];
		return Array.from(room.remoteParticipants.values())
			.filter((participant) => isHostIdentity(participant.identity))
			.map((participant) => participant.identity);
	}

	/** Under "only people I allow": pick the screen now, then ask; approval publishes it. */
	async function requestScreenShare() {
		if (!room || screenShareRequested) return;
		if (shareCooldownSeconds > 0) {
			showNotice(t('meet.screenShareCooldown', { seconds: shareCooldownSeconds }));
			return;
		}
		const hosts = hostIdentities();
		if (hosts.length === 0) {
			showNotice(t('meet.screenShareNoHost'));
			return;
		}

		let tracks: LocalTrack[];
		try {
			tracks = await createLocalScreenTracks({ audio: true });
		} catch {
			return; // Picker dismissed — nothing was captured, nothing to ask for.
		}

		pendingScreenTracks = tracks;
		screenShareRequested = true;
		// Stopping from the browser's own "stop sharing" bar withdraws the request too.
		for (const track of tracks) {
			if (track.source === Track.Source.ScreenShare) {
				track.mediaStreamTrack.addEventListener('ended', () => void cancelScreenShareRequest(), { once: true });
			}
		}

		try {
			await room.localParticipant.sendText(localName, { topic: SCREEN_SHARE_REQUEST_TOPIC, destinationIdentities: hosts });
		} catch {
			releasePendingScreenShare();
			showNotice(t('common.networkError'));
		}
	}

	async function publishPendingScreenShare() {
		const tracks = pendingScreenTracks;
		pendingScreenTracks = [];
		screenShareRequested = false;
		if (!room || tracks.length === 0) return;
		try {
			for (const track of tracks) await room.localParticipant.publishTrack(track);
			showNotice(t('meet.screenShareGranted'));
		} catch {
			// Video may have published before audio failed — take back whatever got out.
			for (const track of tracks) {
				await room.localParticipant.unpublishTrack(track).catch(() => {});
				track.stop();
			}
			showNotice(t('meet.screenShareStartFailed'));
		}
	}

	function releasePendingScreenShare() {
		for (const track of pendingScreenTracks) track.stop();
		pendingScreenTracks = [];
		screenShareRequested = false;
	}

	async function cancelScreenShareRequest() {
		if (!screenShareRequested) return;
		releasePendingScreenShare();
		const hosts = hostIdentities();
		if (!room || hosts.length === 0) return;
		await room.localParticipant
			.sendText('', { topic: SCREEN_SHARE_CANCELLED_TOPIC, destinationIdentities: hosts })
			.catch(() => {});
	}

	function receiveScreenShareRequest(identity: string) {
		if (!isHost || !room || screenShareRequests.some((request) => request.identity === identity)) return;
		const participant = room.remoteParticipants.get(identity);
		if (!participant) return;
		screenShareRequests = [...screenShareRequests, { identity, name: participant.name || t('meet.guest') }];
		// The request still shows in the list; only the chime is rate-limited, so
		// asking again in a loop can't ring the host over and over.
		if (!deafened && requestChimeGate.shouldRing(identity, Date.now())) playAdmissionChime();
	}

	async function setScreenShareAllowed(identity: string, allowed: boolean): Promise<boolean> {
		if (!meetingId) return false;
		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/screen-share`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ identity, allowed })
			});
			if (!response.ok) {
				settingsError = t('meet.screenShareUpdateFailed');
				return false;
			}
			return true;
		} catch {
			settingsError = t('common.networkError');
			return false;
		}
	}

	async function respondToScreenShare(identity: string, allow: boolean) {
		if (!room || screenShareBusyIdentity) return;
		screenShareBusyIdentity = identity;
		settingsError = '';
		try {
			const done = allow
				? await setScreenShareAllowed(identity, true)
				: await room.localParticipant
						.sendText('', { topic: SCREEN_SHARE_DECLINED_TOPIC, destinationIdentities: [identity] })
						.then(() => true)
						.catch(() => false);
			if (done) screenShareRequests = screenShareRequests.filter((request) => request.identity !== identity);
		} finally {
			screenShareBusyIdentity = '';
		}
	}

	async function toggleParticipantScreenShare(identity: string, allowed: boolean) {
		if (screenShareBusyIdentity) return;
		screenShareBusyIdentity = identity;
		try {
			await setScreenShareAllowed(identity, allowed);
		} finally {
			screenShareBusyIdentity = '';
		}
	}

	/** Lets everyone already in the call (and anyone joining later) pick up the host's current rules. */
	function broadcastScreenShareSettings() {
		if (!room || !isHost) return;
		room.localParticipant
			.setAttributes({ screenSharePolicy: screenShareSettings.policy, screenShareMode: screenShareSettings.mode })
			.catch(() => {});
	}

	async function updateScreenShareSettings(changes: { screenSharePolicy?: ScreenSharePolicy; screenShareMode?: ScreenShareMode }) {
		if (!meetingId || settingsBusy) return;
		settingsBusy = true;
		settingsError = '';
		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(changes)
			});
			const body = (await response.json().catch(() => ({}))) as {
				meeting?: { screen_share_policy: ScreenSharePolicy; screen_share_mode: ScreenShareMode };
				error?: string;
			};
			if (!response.ok || !body.meeting) {
				settingsError = body.error ?? t('meetings.couldNotSave');
				// A 502 means the setting did save — only the live update failed — so still reflect it.
				if (response.status !== 502) return;
			}
			applyScreenShareSettings({
				policy: body.meeting?.screen_share_policy ?? changes.screenSharePolicy ?? screenShareSettings.policy,
				mode: body.meeting?.screen_share_mode ?? changes.screenShareMode ?? screenShareSettings.mode
			});
			if (screenShareSettings.policy === 'open') screenShareRequests = [];
			broadcastScreenShareSettings();
		} catch {
			settingsError = t('common.networkError');
		} finally {
			settingsBusy = false;
		}
	}

	async function setCaptionsAllowed(next: boolean) {
		if (!meetingId || settingsBusy) return;
		settingsBusy = true;
		settingsError = '';
		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ captionsEnabled: next })
			});
			if (!response.ok) {
				settingsError = t('meetings.couldNotSave');
				return;
			}
			captions.applyAllowed(next);
			captions.broadcastAllowed();
		} catch {
			settingsError = t('common.networkError');
		} finally {
			settingsBusy = false;
		}
	}

	function togglePanel(next: 'participants' | 'chat' | 'settings' | 'transcript') {
		panel = panel === next ? 'none' : next;
		if (panel === 'chat') unread = 0;
	}

	async function sendChatMessage(text: string) {
		if (!room) return;
		messages = [...messages, { id: crypto.randomUUID(), from: localName, text, isLocal: true, isHost }];
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
				meeting?: {
					require_approval: boolean;
					screen_share_policy: ScreenSharePolicy;
					screen_share_mode: ScreenShareMode;
					captions_enabled: boolean;
				};
			};
			if (response.ok && body.meeting) {
				requireApproval = body.meeting.require_approval;
				if (requireApproval) startAdmissionsPolling();
				applyScreenShareSettings({ policy: body.meeting.screen_share_policy, mode: body.meeting.screen_share_mode });
				broadcastScreenShareSettings();
				captions.applyAllowed(body.meeting.captions_enabled);
				captions.broadcastAllowed();
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
				if (!response.ok || !body.admissions) return;
				pendingAdmissions = body.admissions;
				// Deafened first: requests that arrive while deafened stay unrung, so they
				// still chime once the host is listening again.
				if (!deafened && takeUnseenAdmissions(ringedAdmissionIds, body.admissions).length > 0) {
					playAdmissionChime();
				}
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

	const recordChoices = $derived(recorder.choices(isHost));

	async function leave(reason: 'left' | 'ended' | 'deleted' = 'left') {
		// Save first: MediaRecorder only hands over its last chunk after stop() settles.
		await recorder.finish();
		playLeaveChime();
		stopAdmissionsPolling();
		room?.disconnect();
		onleave(captions.lines, reason);
	}

	/** Set while the host's own end request is out, so the room closing under them isn't read as being ended. */
	let endingMeeting = false;

	async function endMeeting(remove: boolean) {
		if (endingMeeting || !meetingId) return;
		endingMeeting = true;
		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/end`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ delete: remove })
			});
			if (!response.ok) throw new Error(String(response.status));
			await leave(remove ? 'deleted' : 'ended');
		} catch {
			showNotice(t('meet.endFailed'));
		} finally {
			endingMeeting = false;
		}
	}
</script>

<svelte:window onkeydown={handleShortcut} />

<div class="call-stage">
	<div class="call-header">
		<span class="call-header-name">{localName}</span>
		{#if screenShareRequested}
			<span class="call-header-notice call-header-waiting" role="status">
				<Icon name="computer-line" size={14} />
				{t('meet.screenShareWaiting')}
				<button type="button" class="call-header-notice-action" onclick={() => void cancelScreenShareRequest()}>
					{t('common.cancel')}
				</button>
			</span>
		{:else if notice}
			<span class="call-header-notice" role="status">{notice}</span>
		{/if}
		{#if recorder.active}
			<span class="call-header-notice call-header-recording" role="status">
				<span class="call-recording-dot" aria-hidden="true"></span>
				{recorder.kind === 'meeting'
					? t('meet.recordingMeetingSelf', { time: formatElapsed(recorder.elapsed) })
					: t('meet.recordingSelf', { time: formatElapsed(recorder.elapsed) })}
				<button type="button" class="call-header-notice-action" onclick={() => void recorder.finish()}>
					{t('meet.stopRecording')}
				</button>
			</span>
		{:else if recorder.saving}
			<span class="call-header-notice" role="status">{t('meet.recordingSaving')}</span>
		{/if}
		{#each othersRecording as other (other.identity)}
			<span class="call-header-notice call-header-recording" role="status">
				<span class="call-recording-dot" aria-hidden="true"></span>
				{other.recording === 'meeting'
					? t('meet.recordingMeetingBy', { name: other.name })
					: t('meet.recordingBy', { name: other.name })}
			</span>
		{/each}
		{#if captions.someoneWants}
			<span class="call-header-notice call-header-captions" role="status">
				<Icon name="closed-captioning-line" size={14} />
				{t('meet.captionsActive')}
			</span>
		{/if}
	</div>

	<div class="call-body">
		<div class="call-tiles">
			<div class="call-grid" bind:this={layout.grid}>
				<div
					class="call-tile call-tile-screen"
					class:call-tile-featured={featuredShare === LOCAL_SHARE_KEY}
					hidden={!screenShareEnabled}
					role="button"
					tabindex="0"
					title={t('meet.focusScreenShare')}
					aria-pressed={featuredShare === LOCAL_SHARE_KEY}
					onclick={() => focusShare(LOCAL_SHARE_KEY)}
					onkeydown={(event) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							focusShare(LOCAL_SHARE_KEY);
						}
					}}
				>
					<div class="call-tile-media" bind:this={localScreenMediaEl}></div>
					<span class="call-tile-name">
						<span class="call-tile-label">{t('meet.you')} · {t('meet.screenShare')}</span>
					</span>
				</div>
				<div
					class="call-tile call-tile-local"
					class:call-tile-joining={connecting || connectionError}
					class:call-tile-hand-raised={handRaisedAt !== null}
				>
					<div class="call-tile-avatar" style="background: {localColor}">{localInitials}</div>
					<div class="call-tile-media" bind:this={localMediaEl}></div>
					<div class="call-tile-status">
						{#if !micEnabled}<Icon name="mic-off-line" size={14} class="call-tile-status-icon" />{/if}
						{#if !cameraEnabled}<Icon name="camera-off-line" size={14} class="call-tile-status-icon" />{/if}
						{#if deafened}<Icon name="volume-mute-line" size={14} class="call-tile-status-icon" />{/if}
					</div>
					{#if handRaisedAt !== null}
						<i class="ri-hand call-tile-hand" title={t('meet.handRaised')}></i>
					{/if}
					<span class="call-tile-name">
						<span class="call-tile-label">{localName} · {t('meet.you')}</span>
						{#if isHost}<span class="call-host-badge">{t('meet.hostBadge')}</span>{/if}
					</span>
					{#if connectionError}
						<div class="call-joining" role="alert">
							<Icon name="error-warning-line" size={22} />
							<p class="call-joining-title">{t('meet.connectionError')}</p>
							{#if connectionError !== t('meet.connectionError')}
								<p class="call-joining-detail">{connectionError}</p>
							{/if}
							<button type="button" class="call-joining-retry" onclick={retryConnect}>{t('common.tryAgain')}</button>
						</div>
					{:else if connecting}
						<div class="call-joining" role="status">
							<span class="call-joining-spinner" aria-hidden="true"></span>
							<p class="call-joining-title">
								{meetingCode ? t('meet.joiningCode', { code: meetingCode }) : t('meet.joining')}
							</p>
						</div>
					{/if}
				</div>
				<div class="call-tile-group" bind:this={remoteContainerEl}></div>
				{#if !connecting && !connectionError && remoteCount === 0}
					<div class="call-tile call-tile-placeholder">
						<span>{t('meet.waitingForOthers')}</span>
					</div>
				{/if}
			</div>
			{#if layout.pages > 1}
				<button
					type="button"
					class="call-page-arrow call-page-previous"
					style:top={layout.arrowTop}
					disabled={layout.page === 0}
					title={t('meet.tilesPreviousPage')}
					aria-label={t('meet.tilesPreviousPage')}
					onclick={() => layout.showPage(layout.page - 1)}
				>
					<Icon name="arrow-left-s-line" size={22} />
				</button>
				<button
					type="button"
					class="call-page-arrow call-page-next"
					style:top={layout.arrowTop}
					disabled={layout.page === layout.pages - 1}
					title={t('meet.tilesNextPage')}
					aria-label={t('meet.tilesNextPage')}
					onclick={() => layout.showPage(layout.page + 1)}
				>
					<Icon name="arrow-right-s-line" size={22} />
				</button>
				<div class="call-page-dots">
					{#each { length: layout.pages } as _, page (page)}
						<button
							type="button"
							class="call-page-dot"
							aria-label={t('meet.tilesPage', { page: page + 1, total: layout.pages })}
							aria-current={page === layout.page ? 'true' : undefined}
							onclick={() => layout.showPage(page)}
						></button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="call-reactions" aria-hidden="true">
			{#each floatingReactions as reaction (reaction.id)}
				<div class="call-reaction" style="left: {reaction.left}rem">
					<span class="call-reaction-emoji">{reaction.emoji}</span>
					<span class="call-reaction-name">{reaction.name}</span>
				</div>
			{/each}
		</div>

		{#if panel === 'participants'}
			<CallParticipantsPanel
				{roster}
				{isHost}
				screenSharePolicy={screenShareSettings.policy}
				{screenShareBusyIdentity}
				onRename={renameSelf}
				onSetScreenShareAllowed={toggleParticipantScreenShare}
				onClose={() => (panel = 'none')}
			/>
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
				{screenShareSettings}
				{screenShareRequests}
				{screenShareBusyIdentity}
				onUpdateScreenShare={updateScreenShareSettings}
				onRespondToScreenShare={respondToScreenShare}
				captionsAllowed={captions.allowed}
				onSetCaptionsAllowed={setCaptionsAllowed}
				onClose={() => (panel = 'none')}
			/>
		{:else if panel === 'transcript'}
			<CallTranscriptPanel
				lines={captions.lines}
				partials={captions.shownPartials}
				language={captions.spokenLanguage}
				onSetLanguage={(code) => captions.setSpokenLanguage(code)}
				onDownload={(format) => captions.download(format)}
				onClose={() => (panel = 'none')}
			/>
		{/if}
	</div>

	{#if captions.on}
		<div class="call-captions" aria-live="polite">
			{#each captions.shown as line (line.id)}
				<p class="call-caption"><span class="call-caption-name">{line.name}</span> {line.text}</p>
			{/each}
			{#each captions.shownPartials as partial (partial.identity)}
				<p class="call-caption call-caption-partial">
					<span class="call-caption-name">{partial.name}</span> {partial.text}
				</p>
			{/each}
		</div>
	{/if}

	<CallControls
		{deafened}
		{micEnabled}
		micDeviceId={devices.micId}
		{cameraEnabled}
		cameraDeviceId={devices.cameraId}
		speakerDeviceId={devices.speakerId}
		speakerDevices={devices.speakers}
		speakerSelectionSupported={devices.speakerSelectionSupported}
		{backgroundSupported}
		{backgroundOption}
		{screenShareSupported}
		{screenShareEnabled}
		{canShareScreen}
		{screenShareRequested}
		{shareCooldownSeconds}
		pipSupported={pip.supported}
		pipActive={pip.active}
		{recordChoices}
		recording={recorder.active}
		recordingSaving={recorder.saving}
		{panel}
		rosterCount={roster.length}
		handRaised={handRaisedAt !== null}
		{raisedHandCount}
		{unread}
		{isHost}
		pendingAdmissionsCount={pendingAdmissions.length + screenShareRequests.length}
		captionsAllowed={captions.allowed}
		captionsOn={captions.on}
		onToggleCaptions={() => captions.toggle()}
		onToggleDeafen={toggleDeafen}
		onSelectMic={(id) => void devices.selectMic(id)}
		onToggleMic={toggleMic}
		onSelectSpeaker={(id) => devices.selectSpeaker(id)}
		onSelectCamera={(id) => void devices.selectCamera(id)}
		onToggleCamera={toggleCamera}
		onShowBackgroundPicker={() => (showBackgroundPicker = true)}
		onToggleScreenShare={toggleScreenShare}
		onTogglePip={() => void pip.toggle()}
		onRecord={(kind) => void recorder.begin(kind)}
		onStopRecording={() => void recorder.finish()}
		onTogglePanel={togglePanel}
		onToggleHand={toggleHand}
		onSendReaction={sendReaction}
		onLeave={() => leave()}
		onEndMeeting={meetingId ? endMeeting : undefined}
	/>
</div>

{#if showBackgroundPicker}
	<BackgroundPickerModal
		cameraDeviceId={devices.cameraId}
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
		/* A fixed height, not a minimum: a long chat or transcript then scrolls in its panel instead of growing the page. */
		height: 100dvh;
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

	.call-header-notice {
		margin-left: auto;
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		background: rgba(255, 255, 255, 0.1);
	}

	.call-header-recording {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: #fecaca;
		background: rgba(220, 38, 38, 0.22);
	}

	.call-header-recording + .call-header-recording,
	.call-header-notice + .call-header-recording,
	.call-header-notice + .call-header-captions {
		margin-left: 0.5rem;
	}

	.call-header-captions {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* Above the control bar, where Meet puts them: never over a tile or an open panel. */
	.call-captions {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		min-height: 4.5rem;
		padding: 0 1rem;
	}

	.call-caption {
		max-width: 48rem;
		margin: 0;
		padding: 0.25rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 1rem;
		line-height: 1.4;
		text-align: center;
		background: rgba(0, 0, 0, 0.6);
	}

	.call-caption-name {
		font-weight: 600;
		color: rgba(255, 255, 255, 0.7);
	}

	.call-caption-partial {
		color: rgba(255, 255, 255, 0.65);
	}

	.call-recording-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #ef4444;
		animation: call-recording-blink 1.4s ease-in-out infinite;
	}

	@keyframes call-recording-blink {
		50% {
			opacity: 0.35;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.call-recording-dot {
			animation: none;
		}
	}

	.call-header-waiting {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: #fde68a;
		background: rgba(250, 204, 21, 0.18);
	}

	.call-header-notice-action {
		padding: 0.125rem 0.5rem;
		border: none;
		border-radius: 999px;
		font-size: 0.75rem;
		color: #fff;
		background: rgba(255, 255, 255, 0.15);
		cursor: pointer;
	}

	.call-body {
		position: relative;
		flex: 1;
		display: flex;
		gap: 0.75rem;
		min-height: 0;
	}

	.call-tiles {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		min-height: 15rem;
	}

	/* Tiles are placed absolutely by CallLayout, which sizes them to this box. */
	.call-grid {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		/* Horizontal swipes page the tiles; vertical ones still scroll the page. */
		touch-action: pan-y;
	}

	.call-page-arrow {
		position: absolute;
		top: 50%;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border: none;
		border-radius: 999px;
		color: #fff;
		background: rgba(0, 0, 0, 0.6);
		transform: translateY(-50%);
		cursor: pointer;
	}

	.call-page-arrow:disabled {
		opacity: 0;
		pointer-events: none;
	}

	.call-page-previous {
		left: 0.5rem;
	}

	.call-page-next {
		right: 0.5rem;
	}

	.call-page-dots {
		display: flex;
		justify-content: center;
		gap: 0.25rem;
	}

	.call-page-dot {
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
	}

	.call-page-dot::before {
		content: '';
		display: block;
		width: 0.5rem;
		height: 0.5rem;
		margin: auto;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.3);
	}

	.call-page-dot[aria-current='true']::before {
		background: #fff;
	}

	.call-page-arrow:focus-visible,
	.call-page-dot:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.6);
		outline-offset: 2px;
	}

	.call-tile-joining .call-tile-avatar {
		color: transparent;
	}

	.call-joining {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 1rem;
		text-align: center;
		background: rgba(11, 11, 13, 0.6);
		color: #fff;
	}

	.call-joining-title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.call-joining-detail {
		margin: 0;
		max-width: 32ch;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.65);
		overflow-wrap: anywhere;
	}

	.call-joining-retry {
		margin-top: 0.25rem;
		padding: 0.375rem 1rem;
		border: none;
		border-radius: 999px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #0b0b0d;
		background: #fff;
		cursor: pointer;
	}

	.call-joining-retry:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.6);
		outline-offset: 2px;
	}

	.call-joining-spinner {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: #fff;
		animation: call-spin 0.9s linear infinite;
	}

	@keyframes call-spin {
		to {
			transform: rotate(360deg);
		}
	}

	:global(.call-tile-hand) {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 999px;
		font-size: 1rem;
		color: #0b0b0d;
		background: #fbbf24;
	}

	:global(.call-tile-hand[hidden]) {
		display: none;
	}

	:global(.call-tile-hand-raised) {
		box-shadow: inset 0 0 0 2px #fbbf24;
	}

	.call-reactions {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.call-reaction {
		position: absolute;
		bottom: 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
		animation: call-reaction-float 3s ease-out forwards;
	}

	.call-reaction-emoji {
		font-size: 2rem;
		line-height: 1;
	}

	.call-reaction-name {
		max-width: 8rem;
		padding: 0.0625rem 0.5rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: rgba(0, 0, 0, 0.55);
	}

	@keyframes call-reaction-float {
		from {
			opacity: 0;
			transform: translateY(1rem);
		}
		15% {
			opacity: 1;
		}
		75% {
			opacity: 1;
		}
		to {
			opacity: 0;
			transform: translateY(-50vh);
		}
	}

	@keyframes call-reaction-badge {
		from,
		to {
			opacity: 0;
		}
		10%,
		80% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.call-reaction {
			animation: call-reaction-badge 2s linear forwards;
		}
	}

	/* Tiles arriving after the stage is up fade in rather than popping into the grid. */
	.call-tile-group > :global(.call-tile),
	:global(.call-tile-placeholder) {
		animation: call-tile-in 0.25s ease-out;
	}

	@keyframes call-tile-in {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.call-joining-spinner {
			animation: call-pulse 2s ease-in-out infinite;
			border-top-color: rgba(255, 255, 255, 0.2);
		}

		.call-tile-group > :global(.call-tile),
		:global(.call-tile-placeholder) {
			animation: none;
		}
	}

	@keyframes call-pulse {
		50% {
			opacity: 0.4;
		}
	}

	/*
	 * Remote tiles are created with document.createElement, not written in this
	 * component's template — Svelte never sees them, so it never tags them with
	 * its scoping class. Every rule a tile needs must be :global() or it silently
	 * no-ops on remote participants (a mobile camera's portrait video then renders
	 * at its native size with nothing constraining it).
	 */
	:global(.call-tile) {
		position: absolute;
		box-sizing: border-box;
		border-radius: 0.75rem;
		background: #1c1c1f;
		overflow: hidden;
		transition:
			left 0.3s ease,
			top 0.3s ease,
			width 0.3s ease,
			height 0.3s ease;
	}

	/* Until the first layout runs, so a tile never flashes at its natural size. */
	:global(.call-tile:not([style*='width'])) {
		visibility: hidden;
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.call-tile) {
			transition: none;
		}
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
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		max-width: calc(100% - 1rem);
	}

	/* Only the name ellipsizes; the badge must stay readable to be worth anything. */
	:global(.call-tile-label) {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.call-host-badge) {
		flex-shrink: 0;
		padding: 0 0.375rem;
		border-radius: 999px;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: #0b0b0d;
		background: #fbbf24;
	}

	:global(.call-tile-screen) {
		background: #000;
		cursor: pointer;
	}

	/* The share being watched; CallLayout gives it the stage. */
	:global(.call-tile-featured) {
		cursor: default;
	}

	:global(.call-tile-screen:focus-visible) {
		outline: 2px solid rgba(255, 255, 255, 0.6);
		outline-offset: 2px;
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
