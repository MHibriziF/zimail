<script lang="ts">
	import Icon from '../Icon.svelte';
	import DeviceSelect from './DeviceSelect.svelte';
	import { t } from '$lib/i18n';
	import type { RecordingKind } from '$lib/meet/recording-kind';
	import { REACTIONS, type Reaction } from '$lib/meet/reactions';

	let {
		deafened,
		micEnabled,
		micDeviceId,
		cameraEnabled,
		cameraDeviceId,
		speakerDeviceId,
		speakerDevices,
		speakerSelectionSupported,
		backgroundSupported,
		backgroundOption,
		screenShareSupported,
		screenShareEnabled,
		canShareScreen,
		screenShareRequested,
		shareCooldownSeconds,
		pipSupported,
		pipActive,
		recordChoices,
		recording,
		recordingSaving,
		panel,
		rosterCount,
		handRaised,
		raisedHandCount,
		unread,
		isHost,
		pendingAdmissionsCount,
		onToggleDeafen,
		onSelectMic,
		onToggleMic,
		onSelectSpeaker,
		onSelectCamera,
		onToggleCamera,
		onShowBackgroundPicker,
		onToggleScreenShare,
		onTogglePip,
		onRecord,
		onStopRecording,
		onTogglePanel,
		onToggleHand,
		onSendReaction,
		onLeave
	}: {
		deafened: boolean;
		micEnabled: boolean;
		micDeviceId: string;
		cameraEnabled: boolean;
		cameraDeviceId: string;
		speakerDeviceId: string;
		speakerDevices: MediaDeviceInfo[];
		speakerSelectionSupported: boolean;
		backgroundSupported: boolean;
		backgroundOption: string;
		screenShareSupported: boolean;
		screenShareEnabled: boolean;
		/** False under "ask the host first" until the host allows it — the button then asks instead. */
		canShareScreen: boolean;
		screenShareRequested: boolean;
		/** Seconds left after a decline before asking again is allowed; 0 means free. */
		shareCooldownSeconds: number;
		pipSupported: boolean;
		pipActive: boolean;
		/** What this participant may record here — see `recordingChoices`. Empty hides the button. */
		recordChoices: RecordingKind[];
		recording: boolean;
		recordingSaving: boolean;
		panel: 'none' | 'participants' | 'chat' | 'settings';
		rosterCount: number;
		handRaised: boolean;
		raisedHandCount: number;
		unread: number;
		isHost: boolean;
		pendingAdmissionsCount: number;
		onToggleDeafen: () => void;
		onSelectMic: (id: string) => void;
		onToggleMic: () => void;
		onSelectSpeaker: (id: string) => void;
		onSelectCamera: (id: string) => void;
		onToggleCamera: () => void;
		onShowBackgroundPicker: () => void;
		onToggleScreenShare: () => void;
		onTogglePip: () => void;
		onRecord: (kind: RecordingKind) => void;
		onStopRecording: () => void;
		onTogglePanel: (next: 'participants' | 'chat' | 'settings') => void;
		onToggleHand: () => void;
		onSendReaction: (emoji: Reaction) => void;
		onLeave: () => void;
	} = $props();

	let reactionMenuOpen = $state(false);
	let reactionEl = $state<HTMLDivElement>();
	let moreMenuOpen = $state(false);
	let moreEl = $state<HTMLDivElement>();

	/** The pickers stay open for a burst of choices; a click elsewhere or Escape closes them. */
	function closeMenusOutside(event: PointerEvent) {
		const target = event.target as Node;
		if (reactionMenuOpen && !reactionEl?.contains(target)) reactionMenuOpen = false;
		if (moreMenuOpen && !moreEl?.contains(target)) moreMenuOpen = false;
	}

	function closeMenus() {
		reactionMenuOpen = false;
		moreMenuOpen = false;
	}

	const handLabel = $derived(`${handRaised ? t('meet.lowerHand') : t('meet.raiseHand')} (Ctrl+Alt+H)`);

	/** On a phone the panels live in the More menu, so its button carries their alerts. */
	const moreAlert = $derived(unread > 0 || pendingAdmissionsCount > 0 || raisedHandCount > 0);

	/** Unmuting while deafened also brings the audio back, so the mic doubles as "resume audio". */
	const micLabel = $derived.by(() => {
		if (deafened) return t('meet.undeafen');
		return micEnabled ? t('meet.micOn') : t('meet.micOff');
	});
	const micIcon = $derived.by(() => {
		if (deafened) return 'volume-mute-line';
		return micEnabled ? 'mic-line' : 'mic-off-line';
	});

	function fromMore(action: () => void) {
		moreMenuOpen = false;
		action();
	}

	const screenShareLabel = $derived.by(() => {
		if (screenShareEnabled) return t('meet.screenShareOff');
		if (screenShareRequested) return t('meet.screenShareCancelRequest');
		if (shareCooldownSeconds > 0) return t('meet.screenShareCooldown', { seconds: shareCooldownSeconds });
		return canShareScreen ? t('meet.screenShareOn') : t('meet.screenShareAsk');
	});
</script>

<svelte:window
	onpointerdown={closeMenusOutside}
	onkeydown={(event) => event.key === 'Escape' && closeMenus()}
/>

<div class="call-controls">
	<div class="call-group call-group-main">
		<div class="call-btn-pill" class:call-btn-pill-off={!micEnabled}>
			<DeviceSelect kind="audioinput" deviceId={micDeviceId} label={t('meet.chooseMic')} onselect={onSelectMic} menuAlign="start">
				{#snippet extra()}
					{#if speakerSelectionSupported}
						<div class="pill-extra-section">
							<span class="pill-extra-label">{t('meet.chooseSpeaker')}</span>
							{#if speakerDevices.length === 0}
								<span class="pill-extra-empty">{t('meet.chooseSpeaker')}</span>
							{:else}
								{#each speakerDevices as device (device.deviceId)}
									<button
										type="button"
										class="pill-extra-option"
										class:selected={device.deviceId === speakerDeviceId}
										onclick={() => onSelectSpeaker(device.deviceId)}
									>
										{device.label || t('meet.chooseSpeaker')}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				{/snippet}
			</DeviceSelect>
			<button
				type="button"
				class="call-btn-pill-main"
				onclick={onToggleMic}
				aria-label={micLabel}
				title={micLabel}
			>
				<Icon name={micIcon} size={20} />
			</button>
		</div>

		<div class="call-btn-pill" class:call-btn-pill-off={!cameraEnabled}>
			<DeviceSelect kind="videoinput" deviceId={cameraDeviceId} label={t('meet.chooseCamera')} onselect={onSelectCamera} menuAlign="start">
				{#snippet extra()}
					{#if backgroundSupported}
						<div class="pill-extra-section">
							<span class="pill-extra-label">{t('meet.background')}</span>
							<button type="button" class="pill-extra-option" onclick={onShowBackgroundPicker}>
								<span
									class="background-current-swatch"
									style={backgroundOption === 'none'
										? ''
										: backgroundOption === 'blur'
											? 'background: rgba(255, 255, 255, 0.3)'
											: `background-image: url(${backgroundOption})`}
								></span>
								{t('meet.backgroundChange')}
							</button>
						</div>
					{/if}
				{/snippet}
			</DeviceSelect>
			<button
				type="button"
				class="call-btn-pill-main"
				onclick={onToggleCamera}
				aria-label={cameraEnabled ? t('meet.cameraOn') : t('meet.cameraOff')}
				title={cameraEnabled ? t('meet.cameraOn') : t('meet.cameraOff')}
			>
				<Icon name={cameraEnabled ? 'camera-line' : 'camera-off-line'} size={20} />
			</button>
		</div>

		{#if screenShareSupported}
			<button
				type="button"
				class="call-btn"
				class:call-btn-active={screenShareEnabled}
				class:call-btn-pending={screenShareRequested}
				disabled={!screenShareEnabled && shareCooldownSeconds > 0}
				onclick={onToggleScreenShare}
				aria-label={screenShareLabel}
				title={screenShareLabel}
			>
				<Icon name="computer-line" size={20} />
			</button>
		{/if}

		<button
			type="button"
			class="call-btn desktop-only"
			class:call-btn-hand={handRaised}
			onclick={onToggleHand}
			aria-label={handLabel}
			aria-pressed={handRaised}
			title={handLabel}
		>
			<Icon name="hand" size={20} />
		</button>

		<div class="call-menu-anchor desktop-only" bind:this={reactionEl}>
			<button
				type="button"
				class="call-btn"
				class:call-btn-active={reactionMenuOpen}
				onclick={() => (reactionMenuOpen = !reactionMenuOpen)}
				aria-label={t('meet.react')}
				aria-haspopup="menu"
				aria-expanded={reactionMenuOpen}
				title={t('meet.react')}
			>
				<Icon name="emotion-line" size={20} />
			</button>
			{#if reactionMenuOpen}
				<div class="call-reaction-menu" role="menu">
					{#each REACTIONS as emoji (emoji)}
						<button type="button" role="menuitem" onclick={() => onSendReaction(emoji)}>{emoji}</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="call-menu-anchor" bind:this={moreEl}>
			<button
				type="button"
				class="call-btn"
				class:call-btn-active={moreMenuOpen}
				onclick={() => (moreMenuOpen = !moreMenuOpen)}
				aria-label={t('meet.more')}
				aria-haspopup="menu"
				aria-expanded={moreMenuOpen}
				title={t('meet.more')}
			>
				<Icon name="more-2-fill" size={20} />
				{#if moreAlert}<span class="call-btn-dot mobile-only" aria-hidden="true"></span>{/if}
			</button>
			{#if moreMenuOpen}
				<div class="call-menu" role="menu">
					<div class="call-menu-section mobile-only">
						<div class="call-menu-reactions">
							{#each REACTIONS as emoji (emoji)}
								<button
									type="button"
									role="menuitem"
									aria-label={`${t('meet.react')} ${emoji}`}
									onclick={() => fromMore(() => onSendReaction(emoji))}>{emoji}</button
								>
							{/each}
						</div>
						<button type="button" role="menuitem" class:call-menu-on={handRaised} onclick={() => fromMore(onToggleHand)}>
							<Icon name="hand" size={18} />
							<span>{handRaised ? t('meet.lowerHand') : t('meet.raiseHand')}</span>
						</button>
						<button type="button" role="menuitem" onclick={() => fromMore(() => onTogglePanel('participants'))}>
							<Icon name="group-line" size={18} />
							<span>{t('meet.participants')}</span>
							{#if rosterCount > 0}<span class="call-menu-count">{rosterCount}</span>{/if}
						</button>
						<button type="button" role="menuitem" onclick={() => fromMore(() => onTogglePanel('chat'))}>
							<Icon name="chat-3-line" size={18} />
							<span>{t('meet.chat')}</span>
							{#if unread > 0}<span class="call-menu-count call-menu-count-alert">{unread}</span>{/if}
						</button>
						{#if isHost}
							<button type="button" role="menuitem" onclick={() => fromMore(() => onTogglePanel('settings'))}>
								<Icon name="settings-3-line" size={18} />
								<span>{t('meet.settings')}</span>
								{#if pendingAdmissionsCount > 0}<span class="call-menu-count">{pendingAdmissionsCount}</span>{/if}
							</button>
						{/if}
					</div>
					<div class="call-menu-section">
						{#if recording}
							<button type="button" role="menuitem" class="call-menu-alert" onclick={() => fromMore(onStopRecording)}>
								<Icon name="stop-circle-line" size={18} />
								<span>{t('meet.stopRecording')}</span>
							</button>
						{:else if !recordingSaving}
							{#each recordChoices as kind (kind)}
								<button type="button" role="menuitem" onclick={() => fromMore(() => onRecord(kind))}>
									<Icon name="record-circle-line" size={18} />
									<span>
										{kind === 'meeting' ? t('meet.recordMeeting') : t('meet.recordView')}
										<small>{kind === 'meeting' ? t('meet.recordMeetingHint') : t('meet.recordViewHint')}</small>
									</span>
								</button>
							{/each}
						{/if}
						{#if pipSupported}
							<button type="button" role="menuitem" onclick={() => fromMore(onTogglePip)}>
								<Icon name={pipActive ? 'picture-in-picture-exit-line' : 'picture-in-picture-2-line'} size={18} />
								<span>{pipActive ? t('meet.pipOff') : t('meet.pipOn')}</span>
							</button>
						{/if}
						{#if backgroundSupported}
							<button type="button" role="menuitem" onclick={() => fromMore(onShowBackgroundPicker)}>
								<Icon name="image-line" size={18} />
								<span>{t('meet.backgroundChange')}</span>
							</button>
						{/if}
						<button type="button" role="menuitem" onclick={() => fromMore(onToggleDeafen)}>
							<Icon name={deafened ? 'volume-up-line' : 'headphone-line'} size={18} />
							<span>{deafened ? t('meet.undeafen') : t('meet.deafen')}</span>
						</button>
					</div>
				</div>
			{/if}
		</div>

		<button type="button" class="call-btn call-btn-leave" onclick={onLeave} aria-label={t('meet.leave')} title={t('meet.leave')}>
			<Icon name="phone-line" size={20} />
		</button>
	</div>

	<div class="call-group call-group-panels desktop-only">
		<button
			type="button"
			class="call-btn"
			class:call-btn-active={panel === 'participants'}
			onclick={() => onTogglePanel('participants')}
			aria-label={t('meet.participants')}
			title={t('meet.participants')}
		>
			<Icon name="group-line" size={20} />
			{#if rosterCount > 0}<span class="call-btn-badge">{rosterCount}</span>{/if}
			{#if raisedHandCount > 0}
				<span class="call-btn-badge call-btn-badge-hand" title={t('meet.raisedHandsCount', { count: raisedHandCount })}>
					<Icon name="hand" size={10} />{raisedHandCount}
				</span>
			{/if}
		</button>
		<button
			type="button"
			class="call-btn"
			class:call-btn-active={panel === 'chat'}
			onclick={() => onTogglePanel('chat')}
			aria-label={t('meet.chat')}
			title={t('meet.chat')}
		>
			<Icon name="chat-3-line" size={20} />
			{#if unread > 0}<span class="call-btn-badge call-btn-badge-alert">{unread}</span>{/if}
		</button>
		{#if isHost}
			<button
				type="button"
				class="call-btn"
				class:call-btn-active={panel === 'settings'}
				onclick={() => onTogglePanel('settings')}
				aria-label={t('meet.settings')}
				title={t('meet.settings')}
			>
				<Icon name="settings-3-line" size={20} />
				{#if pendingAdmissionsCount > 0}<span class="call-btn-badge">{pendingAdmissionsCount}</span>{/if}
			</button>
		{/if}
	</div>
</div>

<style>
	/* Call actions in the middle, panels apart on the right, as Meet does. */
	.call-controls {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
		align-items: center;
		gap: 0.75rem;
		padding-bottom: 0.5rem;
	}

	.call-group {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.call-group-main {
		grid-column: 2;
	}

	.call-group-panels {
		grid-column: 3;
		justify-self: end;
	}

	/* Scoped under .call-controls so they outrank each element's own display. */
	.call-controls .mobile-only {
		display: none;
	}

	/* A phone gets one row: mic, camera, share, More and leave; the rest moves into More. */
	@media (max-width: 760px) {
		.call-controls {
			display: flex;
			justify-content: center;
		}

		.call-group {
			gap: 0.5rem;
		}

		.call-controls .desktop-only {
			display: none;
		}

		.call-controls .mobile-only {
			display: block;
		}

		.call-controls .call-menu-section.mobile-only {
			display: flex;
		}
	}

	/*
	 * One pill made of two adjacent segments — the device-picker chevron and
	 * the main toggle each paint their own background and their own outer
	 * corner, rather than the pill clipping them with overflow:hidden, which
	 * would also clip the chevron's dropdown menu (it opens outside this box).
	 */
	.call-btn-pill {
		display: flex;
		align-items: stretch;
		height: 48px;
		/* Main segment matches the other round buttons in this bar (screen
		   share, participants, chat); the chevron is secondary, so it sits
		   darker rather than blending into the main segment. */
		--seg-main-bg: #26262b;
		--seg-main-bg-hover: #2c2c31;
		--device-select-bg: #18181b;
		--device-select-bg-hover: #202024;
	}

	.call-btn-pill-off {
		--seg-main-bg: #dc2626;
		--seg-main-bg-hover: #ef4444;
		--device-select-bg: #7f1d1d;
		--device-select-bg-hover: #932222;
	}

	.call-btn-pill-main {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		border: none;
		border-radius: 0 999px 999px 0;
		background: var(--seg-main-bg);
		color: #fff;
		cursor: pointer;
	}

	.call-btn-pill-main:hover {
		background: var(--seg-main-bg-hover);
	}

	.call-btn {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border: none;
		border-radius: 999px;
		background: #26262b;
		color: #fff;
		cursor: pointer;
	}

	.call-btn:hover {
		background: #34343a;
	}

	.call-btn-active {
		background: #3f3f46;
		box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.3);
	}

	.call-menu-anchor {
		position: relative;
	}

	.call-menu {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 50%;
		z-index: 20;
		display: flex;
		flex-direction: column;
		width: 17rem;
		max-height: calc(100dvh - 8rem);
		overflow-y: auto;
		padding: 0.375rem;
		border-radius: 0.75rem;
		background: #1f1f23;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		transform: translateX(-50%);
	}

	.call-menu-section {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.call-menu-section.mobile-only {
		margin-bottom: 0.375rem;
		padding-bottom: 0.375rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.call-menu-section > button {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		text-align: left;
		color: #fff;
		background: transparent;
	}

	.call-menu-section > button:hover,
	.call-menu-section > button:focus-visible {
		background: #34343a;
	}

	.call-menu-section > button > span:first-of-type {
		flex: 1;
	}

	.call-menu-section > .call-menu-on {
		color: #fbbf24;
	}

	.call-menu-section > .call-menu-alert {
		color: #f87171;
	}

	.call-menu small {
		display: block;
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: #a1a1aa;
	}

	.call-menu-count {
		padding: 0 0.375rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: #52525b;
	}

	.call-menu-count-alert {
		background: #dc2626;
	}

	.call-menu-reactions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		padding-bottom: 0.25rem;
	}

	.call-menu-reactions button {
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		font-size: 1.375rem;
		line-height: 1;
		background: transparent;
	}

	.call-menu-reactions button:hover,
	.call-menu-reactions button:focus-visible {
		background: #34343a;
	}

	.call-btn-dot {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 999px;
		background: #dc2626;
		box-shadow: 0 0 0 2px #26262b;
	}

	.call-btn-hand {
		color: #0b0b0d;
		background: #fbbf24;
	}

	.call-btn-hand:hover {
		background: #fcd34d;
	}

	.call-reaction-menu {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 50%;
		z-index: 20;
		display: flex;
		gap: 0.125rem;
		padding: 0.375rem;
		border-radius: 999px;
		background: #1f1f23;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
		transform: translateX(-50%);
	}

	.call-reaction-menu button {
		width: 2.5rem;
		height: 2.5rem;
		border: none;
		border-radius: 999px;
		font-size: 1.375rem;
		line-height: 1;
		background: transparent;
		cursor: pointer;
	}

	.call-reaction-menu button:hover,
	.call-reaction-menu button:focus-visible {
		background: #34343a;
	}

	/* More sits right of centre on a phone, so its menu lines up with Leave's right edge to stay on screen. */
	@media (max-width: 760px) {
		.call-menu {
			left: auto;
			right: calc(-48px - 0.5rem);
			transform: none;
		}
	}

	/* Waiting on the host: a pulsing ring, and pressing again withdraws the request. */
	.call-btn-pending {
		box-shadow: 0 0 0 2px #facc15;
		animation: call-btn-pulse 1.6s ease-in-out infinite;
	}

	@keyframes call-btn-pulse {
		50% {
			box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.35);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.call-btn-pending {
			animation: none;
		}
	}

	.call-btn-badge {
		position: absolute;
		top: -2px;
		right: -2px;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		background: #52525b;
		font-size: 0.625rem;
		font-weight: 600;
	}

	.call-btn-badge-hand {
		right: auto;
		left: -2px;
		gap: 0.125rem;
		color: #0b0b0d;
		background: #fbbf24;
	}

	.call-btn-badge-alert {
		background: #dc2626;
	}

	.call-btn-leave {
		background: #dc2626;
	}

	.call-btn-leave:hover {
		background: #ef4444;
	}

	/* Lives inside the mic/camera pill's own popup (see DeviceSelect's `extra` slot) rather than a separate button, so it doesn't add to the control bar. */
	.pill-extra-section {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 180px;
	}

	.pill-extra-label {
		padding: 0.25rem 0.5rem 0;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: rgba(255, 255, 255, 0.5);
	}

	.pill-extra-empty {
		padding: 0.375rem 0.5rem;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.5);
	}

	.pill-extra-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: #fff;
		font-size: 0.8125rem;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.pill-extra-option:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.pill-extra-option.selected {
		background: rgba(255, 255, 255, 0.16);
		font-weight: 600;
	}

	.background-current-swatch {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		border-radius: 0.25rem;
		background-size: cover;
		background-position: center;
		background-color: rgba(255, 255, 255, 0.15);
	}
</style>
