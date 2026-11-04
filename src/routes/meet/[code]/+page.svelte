<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import Logo from '$lib/components/Logo.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CallStage from '$lib/components/meet/CallStage.svelte';
	import DeviceSelect from '$lib/components/meet/DeviceSelect.svelte';
	import BackgroundPickerModal from '$lib/components/meet/BackgroundPickerModal.svelte';
	import { applyDeafenToggle, applyMicToggle } from '$lib/meet/av-state';
	import { deviceErrorKey } from '$lib/meet/device-errors';
	import { APP_NAME } from '$lib/constants';
	import { initials } from '$lib/mail/folders';
	import { DEFAULT_SCREEN_SHARE, type ScreenShareSettings } from '$lib/meet/screen-share';
	import { transcriptFile, type CaptionLine } from '$lib/meet/captions';
	import { downloadBlob } from '$lib/meet/recorder';
	import { relativeTime } from '$lib/meet/schedule';
	import { page } from '$app/stores';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state(data.userName ?? '');
	let joining = $state(false);
	let error = $state('');
	let session = $state<{
		url: string;
		token: string;
		displayName: string;
		meetingId: string;
		screenShare: ScreenShareSettings;
		captions: boolean;
		captionToken: string;
	} | null>(null);
	let left = $state(false);
	/** Kept across leaving, so it can be saved afterwards and carries on if they rejoin. */
	let transcript = $state.raw<CaptionLine[]>([]);
	let waitingAdmissionId = $state('');
	let waitingDenied = $state(false);
	let waitingForHost = $state(false);
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let hostRetry: ReturnType<typeof setTimeout> | null = null;

	const locale = $derived(intlLocale($page.data.locale ?? DEFAULT_LOCALE));
	const scheduleText = $derived.by(() => {
		if (!data.schedule) return '';
		const start = new Date(data.schedule.start);
		const end = new Date(data.schedule.end);
		const day = new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(start);
		const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
		return `${day}, ${time.formatRange(start, end)}`;
	});
	let now = $state(Date.now());
	/** Either wait: for the host to start, or for them to let this guest in. */
	const waiting = $derived(!!waitingAdmissionId || waitingForHost);
	let waitingSince = $state(0);
	const waitedFor = $derived.by(() => {
		const seconds = Math.max(0, Math.floor((now - waitingSince) / 1000));
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	});

	// The lobby's clock only needs minutes; the waiting screen counts seconds.
	$effect(() => {
		if (!waiting) return;
		waitingSince = Date.now();
		now = waitingSince;
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});
	const scheduleRelative = $derived.by(() => {
		if (!data.schedule) return '';
		const start = new Date(data.schedule.start).getTime();
		const end = new Date(data.schedule.end).getTime();
		if (now >= start && now < end) return t('meet.scheduleNow');
		return relativeTime(start - now, locale);
	});

	// Local device check before joining — lets people fix a muted mic or a
	// covered camera instead of discovering it once everyone can already see them.
	let previewStream: MediaStream | null = null;
	let previewVideoEl = $state<HTMLVideoElement>();
	let micOn = $state(true);
	let cameraOn = $state(true);
	let micDeviceId = $state('');
	let cameraDeviceId = $state('');
	let micLevel = $state(0);
	let deviceError = $state('');
	let backgroundOption = $state('none');
	let showBackgroundPicker = $state(false);
	let deafened = $state(false);
	let micOnBeforeDeafen: boolean | null = null;

	let audioCtx: AudioContext | null = null;
	let analyser: AnalyserNode | null = null;
	let levelFrame = 0;

	const previewInitials = $derived(initials(name || t('meet.guest')));

	onMount(() => {
		void startPreview();
		const clock = setInterval(() => (now = Date.now()), 30_000);
		return () => {
			clearInterval(clock);
			stopPreview();
		};
	});

	/** A check still in flight when the page goes must not start another one. */
	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		stopWaiting();
	});

	function attachPreview(stream: MediaStream) {
		previewStream = stream;
		if (previewVideoEl) previewVideoEl.srcObject = stream;
		if (stream.getAudioTracks().length > 0) startLevelMeter(stream);
	}

	async function startPreview() {
		// The combined request's error speaks for both devices, so it's the one to explain.
		let bothFailed: unknown;
		try {
			attachPreview(await navigator.mediaDevices.getUserMedia({ video: true, audio: true }));
			return;
		} catch (error) {
			// Fall through — camera and mic may need to be requested separately
			// when only one of them is actually available or permitted.
			bothFailed = error;
		}
		try {
			cameraOn = true;
			micOn = false;
			attachPreview(await navigator.mediaDevices.getUserMedia({ video: true }));
			return;
		} catch {
			cameraOn = false;
		}
		try {
			micOn = true;
			attachPreview(await navigator.mediaDevices.getUserMedia({ audio: true }));
		} catch {
			micOn = false;
			deviceError = t(deviceErrorKey(bothFailed));
		}
	}

	function stopPreview() {
		cancelAnimationFrame(levelFrame);
		analyser = null;
		audioCtx?.close();
		audioCtx = null;
		previewStream?.getTracks().forEach((track) => track.stop());
		previewStream = null;
	}

	function startLevelMeter(stream: MediaStream) {
		audioCtx = new AudioContext();
		const source = audioCtx.createMediaStreamSource(stream);
		analyser = audioCtx.createAnalyser();
		analyser.fftSize = 256;
		source.connect(analyser);
		const data = new Uint8Array(analyser.frequencyBinCount);
		const loop = () => {
			if (!analyser) return;
			analyser.getByteFrequencyData(data);
			const average = data.reduce((sum, value) => sum + value, 0) / data.length;
			micLevel = Math.min(1, average / 128);
			levelFrame = requestAnimationFrame(loop);
		};
		loop();
	}

	function toggleMic() {
		({ micEnabled: micOn, deafened, micEnabledBeforeDeafen: micOnBeforeDeafen } = applyMicToggle({
			micEnabled: micOn,
			deafened,
			micEnabledBeforeDeafen: micOnBeforeDeafen
		}));
		previewStream?.getAudioTracks().forEach((track) => (track.enabled = micOn));
	}

	/** No remote audio exists yet in the lobby, so this just stages "join already deafened" for CallStage to pick up. */
	function toggleDeafen() {
		({ micEnabled: micOn, deafened, micEnabledBeforeDeafen: micOnBeforeDeafen } = applyDeafenToggle({
			micEnabled: micOn,
			deafened,
			micEnabledBeforeDeafen: micOnBeforeDeafen
		}));
		previewStream?.getAudioTracks().forEach((track) => (track.enabled = micOn));
	}

	function toggleCamera() {
		cameraOn = !cameraOn;
		previewStream?.getVideoTracks().forEach((track) => (track.enabled = cameraOn));
	}

	function exactDevice(id: string): MediaTrackConstraints | true {
		return id ? { deviceId: { exact: id } } : true;
	}

	/**
	 * Re-requests the preview so the picked device takes effect. Only the devices the
	 * preview already has, plus the picked one: a missing camera mustn't fail a mic change.
	 */
	async function applyDeviceSelection(picked: 'camera' | 'mic') {
		const has = (kind: 'video' | 'audio') =>
			!previewStream || previewStream.getTracks().some((track) => track.kind === kind);
		const wantVideo = picked === 'camera' || has('video');
		const wantAudio = picked === 'mic' || has('audio');
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: wantVideo && exactDevice(cameraDeviceId),
				audio: wantAudio && exactDevice(micDeviceId)
			});
			stopPreview();
			attachPreview(stream);
			stream.getAudioTracks().forEach((track) => (track.enabled = micOn));
			stream.getVideoTracks().forEach((track) => (track.enabled = cameraOn));
			deviceError = '';
		} catch (error) {
			deviceError = t(deviceErrorKey(error));
		}
	}

	function selectMic(id: string) {
		micDeviceId = id;
		void applyDeviceSelection('mic');
	}

	function selectCamera(id: string) {
		cameraDeviceId = id;
		void applyDeviceSelection('camera');
	}

	function join(event: SubmitEvent) {
		event.preventDefault();
		if (joining) return;
		void requestJoin();
	}

	/** Asks again every few seconds while the room is waiting for its host to start it. */
	const HOST_RETRY_MS = 5000;

	async function requestJoin() {
		hostRetry = null;
		joining = true;
		error = '';
		const epoch = waitEpoch;

		const displayName = name.trim() || t('meet.guest');

		try {
			const response = await fetch(`/api/meetings/join/${encodeURIComponent(data.code)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: displayName })
			});
			const body = (await response.json().catch(() => ({}))) as {
				url?: string;
				token?: string;
				roomName?: string;
				screenShare?: ScreenShareSettings;
				captions?: boolean;
				captionToken?: string;
				pending?: boolean;
				admissionId?: string;
				waitingForHost?: boolean;
				error?: string;
			};
			if (destroyed || epoch !== waitEpoch) return;
			if (body.waitingForHost) {
				waitingForHost = true;
				hostRetry = setTimeout(() => void requestJoin(), HOST_RETRY_MS);
				return;
			}
			waitingForHost = false;
			if (body.pending && body.admissionId) {
				waitingAdmissionId = body.admissionId;
				pollAdmission(body.admissionId, displayName);
				return;
			}
			if (!response.ok || !body.url || !body.token || !body.roomName) {
				error = body.error ?? t('meet.invalidLink');
				return;
			}
			// Hand the devices off to LiveKit's own capture rather than holding two readers open.
			stopPreview();
			session = {
				url: body.url,
				token: body.token,
				displayName,
				meetingId: body.roomName,
				screenShare: body.screenShare ?? DEFAULT_SCREEN_SHARE,
				captions: body.captions ?? false,
				captionToken: body.captionToken ?? ''
			};
		} catch {
			// A dropped check while waiting for the host just tries again; otherwise say so.
			if (destroyed || epoch !== waitEpoch) return;
			if (waitingForHost) hostRetry = setTimeout(() => void requestJoin(), HOST_RETRY_MS);
			else error = t('common.networkError');
		} finally {
			joining = false;
		}
	}

	/** Polls until the host admits or denies this request — see join/[code]/admission/[admissionId]. */
	function pollAdmission(admissionId: string, displayName: string) {
		const epoch = waitEpoch;
		const check = async () => {
			try {
				const response = await fetch(
					`/api/meetings/join/${encodeURIComponent(data.code)}/admission/${encodeURIComponent(admissionId)}?name=${encodeURIComponent(displayName)}`
				);
				const body = (await response.json().catch(() => ({}))) as {
					status?: 'pending' | 'admitted' | 'denied';
					url?: string;
					token?: string;
					roomName?: string;
					screenShare?: ScreenShareSettings;
					captions?: boolean;
					captionToken?: string;
				};
				if (destroyed || epoch !== waitEpoch) return;
				if (body.status === 'admitted' && body.url && body.token && body.roomName) {
					stopWaiting();
					stopPreview();
					session = {
						url: body.url,
						token: body.token,
						displayName,
						meetingId: body.roomName,
						screenShare: body.screenShare ?? DEFAULT_SCREEN_SHARE,
						captions: body.captions ?? false,
						captionToken: body.captionToken ?? ''
					};
				} else if (body.status === 'denied') {
					stopWaiting();
					waitingDenied = true;
				}
			} catch {
				// A dropped poll just retries on the next tick — the request stays pending either way.
			}
		};
		if (destroyed) return;
		void check();
		pollTimer = setInterval(() => void check(), 3000);
	}

	/** Back to the lobby. A request the host hasn't answered stays on their list until they do. */
	function leaveWaiting() {
		waitEpoch++;
		stopWaiting();
		waitingForHost = false;
	}

	/** Bumped when the guest stops waiting, so a check already in flight is ignored. */
	let waitEpoch = 0;

	function stopWaiting() {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
		waitingAdmissionId = '';
		if (hostRetry) clearTimeout(hostRetry);
		hostRetry = null;
	}

	function onleave(lines: CaptionLine[]) {
		transcript = $state.snapshot(lines);
		session = null;
		left = true;
	}

	function downloadTranscript(format: 'txt' | 'vtt') {
		const { blob, filename } = transcriptFile(transcript, data.code, format);
		downloadBlob(blob, filename);
	}

	function rejoin() {
		left = false;
		waitingDenied = false;
		void startPreview();
	}
</script>

<svelte:head><title>{t('meet.title', { app: APP_NAME })}</title></svelte:head>

{#if session}
	<CallStage
		url={session.url}
		token={session.token}
		displayName={session.displayName}
		initialMicEnabled={micOn}
		initialCameraEnabled={cameraOn}
		initialMicDeviceId={micDeviceId}
		initialCameraDeviceId={cameraDeviceId}
		initialBackgroundOption={backgroundOption}
		initialDeafened={deafened}
		isLoggedIn={data.isLoggedIn}
		meetingId={session.meetingId}
		meetingCode={data.code}
		initialScreenShare={session.screenShare}
		initialCaptionsAllowed={session.captions}
		captionToken={session.captionToken}
		initialTranscript={transcript}
		{onleave}
	/>
{:else}
	<div class="auth-shell">
		<div class="auth-card">
			<div class="auth-brand">
				{#if waiting && !left}
					<div class="wait-mark" aria-hidden="true">
						<span class="wait-ring"></span>
						<span class="wait-ring wait-ring-late"></span>
						<Logo size={44} />
					</div>
					<h1>{waitingForHost ? t('meet.waitingStartTitle') : t('meet.waitingAdmissionTitle')}</h1>
					<p class="wait-lead" role="status">{waitingForHost ? t('meet.waitingForHostStart') : t('meet.waitingForHost')}</p>
					<span class="wait-timer">{t('meet.waitingFor', { time: waitedFor })}</span>
				{:else}
					<div class="brand-icon"><Logo size={48} /></div>
					<h1>{left ? t('meet.leftTitle') : t('meet.title', { app: APP_NAME })}</h1>
				{/if}
				{#if scheduleText && !left}
					<p class="meet-schedule">
						<Icon name="calendar-line" size={15} />
						<span>{t('meet.scheduledFor', { time: scheduleText })}</span>
						<span class="meet-schedule-when">{scheduleRelative}</span>
					</p>
				{/if}
			</div>

			{#if !data.code}
				<p class="note">{t('meet.invalidLink')}</p>
			{:else if left}
				{#if transcript.length > 0}
					<p class="note">{t('meet.leftTranscript')}</p>
					<div class="left-actions">
						<button type="button" class="btn-secondary" onclick={() => downloadTranscript('txt')}>
							<Icon name="download-2-line" size={16} />{t('meet.transcriptDownloadText')}
						</button>
						<button type="button" class="btn-secondary" onclick={() => downloadTranscript('vtt')}>
							<Icon name="closed-captioning-line" size={16} />{t('meet.transcriptDownloadSubtitles')}
						</button>
					</div>
				{/if}
				<div class="left-actions">
					<button type="button" class="btn-secondary" onclick={rejoin}>{t('meet.rejoin')}</button>
					<a href="/" class="btn-primary">{t('meet.returnHome')}</a>
				</div>
			{:else if waitingDenied}
				<p class="note">{t('meet.admissionDenied')}</p>
				<div class="left-actions">
					<a href="/" class="btn-primary">{t('meet.returnHome')}</a>
				</div>
			{:else}
				<div class="lobby-preview">
					<div class="lobby-video">
						<video
							bind:this={previewVideoEl}
							class="lobby-video-el"
							autoplay
							playsinline
							muted
							hidden={!cameraOn}
						></video>
						{#if !cameraOn}
							<div class="lobby-avatar">{previewInitials}</div>
						{/if}
					</div>
					<div class="lobby-controls">
						<button
							type="button"
							class="lobby-round-btn"
							class:lobby-round-btn-danger={deafened}
							onclick={toggleDeafen}
							aria-label={deafened ? t('meet.undeafen') : t('meet.deafen')}
						>
							<Icon name={deafened ? 'volume-mute-line' : 'headphone-line'} size={18} />
						</button>
						<div class="lobby-btn-pill" class:lobby-btn-pill-off={!micOn}>
							<DeviceSelect kind="audioinput" deviceId={micDeviceId} label={t('meet.chooseMic')} onselect={selectMic} menuAlign="start" />
							<button
								type="button"
								class="lobby-btn-pill-main"
								onclick={toggleMic}
								aria-label={micOn ? t('meet.micOn') : t('meet.micOff')}
							>
								<Icon name={micOn ? 'mic-line' : 'mic-off-line'} size={18} />
							</button>
						</div>
						<div class="lobby-meter" aria-hidden="true">
							<div class="lobby-meter-fill" style="transform: scaleX({micOn ? micLevel : 0})"></div>
						</div>
						<div class="lobby-btn-pill" class:lobby-btn-pill-off={!cameraOn}>
							<DeviceSelect kind="videoinput" deviceId={cameraDeviceId} label={t('meet.chooseCamera')} onselect={selectCamera} menuAlign="start" />
							<button
								type="button"
								class="lobby-btn-pill-main"
								onclick={toggleCamera}
								aria-label={cameraOn ? t('meet.cameraOn') : t('meet.cameraOff')}
							>
								<Icon name={cameraOn ? 'camera-line' : 'camera-off-line'} size={18} />
							</button>
						</div>
						<button type="button" class="lobby-round-btn" onclick={() => (showBackgroundPicker = true)} aria-label={t('meet.backgroundChange')}>
							<Icon name="image-2-line" size={18} />
						</button>
					</div>
					{#if deviceError}<p class="note lobby-error">{deviceError}</p>{/if}
				</div>

				{#if showBackgroundPicker}
					<BackgroundPickerModal
						{cameraDeviceId}
						initialOption={backgroundOption}
						isLoggedIn={data.isLoggedIn}
						onapply={(picked) => (backgroundOption = picked)}
						onclose={() => (showBackgroundPicker = false)}
					/>
				{/if}

				{#if waiting}
					<!-- The host is deciding on the name they were shown, so it stays fixed while waiting. -->
					<div class="wait-panel">
						<span class="wait-as">{t('meet.joiningAs', { name: name.trim() || t('meet.guest') })}</span>
						<button type="button" class="btn-secondary" onclick={leaveWaiting}>{t('meet.stopWaiting')}</button>
					</div>
				{:else}
				<form class="mt-8 space-y-4" onsubmit={join}>
					<div>
						<label for="name" class="text-sm text-[var(--color-text-secondary)]">
							{t('meet.yourName')}
						</label>
						<input
							id="name"
							type="text"
							bind:value={name}
							maxlength={100}
							placeholder={t('meet.namePlaceholder')}
							autocomplete="name"
							class="auth-input"
						/>
					</div>

					{#if error}
						<p class="text-sm text-[var(--color-danger)]">{error}</p>
					{/if}

					<button type="submit" disabled={joining} class="btn-primary mt-2 w-full py-2.5">
						{joining ? t('meet.joining') : t('meet.join')}
					</button>
				</form>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.auth-brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.brand-icon {
		display: flex;
		margin-bottom: 1rem;
		border-radius: 0.75rem;
		box-shadow: var(--shadow-sm);
	}

	.wait-mark {
		position: relative;
		display: grid;
		place-items: center;
		width: 5.5rem;
		height: 5.5rem;
		margin-bottom: 0.75rem;
	}

	.wait-ring {
		position: absolute;
		inset: 0;
		border-radius: 999px;
		background: var(--color-accent);
		opacity: 0;
		animation: wait-pulse 2.4s ease-out infinite;
	}

	.wait-ring-late {
		animation-delay: 1.2s;
	}

	.wait-mark :global(img) {
		position: relative;
	}

	@keyframes wait-pulse {
		0% {
			transform: scale(0.55);
			opacity: 0.35;
		}
		100% {
			transform: scale(1.15);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wait-ring {
			animation: none;
			opacity: 0.15;
		}
	}

	.wait-lead {
		max-width: 22rem;
		margin-top: 0.5rem;
		font-size: 0.9375rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.wait-timer {
		margin-top: 0.75rem;
		padding: 0.25rem 0.625rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--color-accent-text);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	.wait-panel {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 2rem;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
	}

	.wait-as {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.meet-schedule {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.25rem 0.5rem;
		margin-top: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.meet-schedule-when {
		font-weight: 500;
		color: var(--color-accent-text);
	}

	.note {
		margin-top: 1rem;
		font-size: 0.875rem;
		line-height: 1.5;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.lobby-preview {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.lobby-video {
		position: relative;
		width: 100%;
		aspect-ratio: 4 / 3;
		border-radius: 0.75rem;
		overflow: hidden;
		background: #1c1c1f;
	}

	.lobby-video-el {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scaleX(-1);
	}

	.lobby-avatar {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.75rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.9);
		background: var(--color-accent, #3b82f6);
	}

	.lobby-controls {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	/*
	 * One pill made of two adjacent segments — see the matching comment in
	 * CallStage.svelte for why the pill itself can't use overflow:hidden.
	 */
	.lobby-btn-pill {
		display: flex;
		align-items: stretch;
		height: 40px;
		flex-shrink: 0;
		color: var(--color-text-primary, #fff);
		/* The chevron is secondary to the main toggle, so it sits darker
		   rather than blending into (or outshining) the main segment. */
		--seg-main-bg: #3f3f46;
		--seg-main-bg-hover: #4b4b54;
		--device-select-bg: #232327;
		--device-select-bg-hover: #2b2b30;
	}

	.lobby-btn-pill-off {
		--seg-main-bg: #dc2626;
		--seg-main-bg-hover: #ef4444;
		--device-select-bg: #7f1d1d;
		--device-select-bg-hover: #932222;
	}

	.lobby-btn-pill-main {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		border: none;
		border-radius: 0 999px 999px 0;
		background: var(--seg-main-bg);
		color: inherit;
		cursor: pointer;
	}

	.lobby-btn-pill-main:hover {
		background: var(--seg-main-bg-hover);
	}

	.lobby-round-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		border: none;
		border-radius: 999px;
		background: #3f3f46;
		color: var(--color-text-primary, #fff);
		cursor: pointer;
	}

	.lobby-round-btn:hover {
		background: #4b4b54;
	}

	.lobby-round-btn-danger {
		background: #7f1d1d;
	}

	.lobby-round-btn-danger:hover {
		background: #932222;
	}

	.lobby-meter {
		width: 80px;
		height: 6px;
		border-radius: 999px;
		background: var(--color-surface-2, #26262b);
		overflow: hidden;
	}

	.lobby-meter-fill {
		width: 100%;
		height: 100%;
		transform-origin: left;
		background: #22c55e;
		transition: transform 60ms linear;
	}

	.lobby-error {
		margin-top: 0;
	}

	.left-actions {
		display: flex;
		justify-content: center;
		gap: 0.625rem;
		margin-top: 1.5rem;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--color-line, rgba(255, 255, 255, 0.15));
		border-radius: 0.625rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-primary, #fff);
		background: transparent;
		cursor: pointer;
	}

	.btn-secondary:hover {
		background: var(--color-surface-2, rgba(255, 255, 255, 0.06));
	}
</style>
