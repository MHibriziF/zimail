<script lang="ts">
	import Icon from '../Icon.svelte';
	import DeviceSelect from './DeviceSelect.svelte';
	import { t } from '$lib/i18n';

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
		pipSupported,
		pipActive,
		panel,
		rosterCount,
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
		onTogglePanel,
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
		pipSupported: boolean;
		pipActive: boolean;
		panel: 'none' | 'participants' | 'chat' | 'settings';
		rosterCount: number;
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
		onTogglePanel: (next: 'participants' | 'chat' | 'settings') => void;
		onLeave: () => void;
	} = $props();
</script>

<div class="call-controls">
	<button
		type="button"
		class="call-btn"
		class:call-btn-danger-active={deafened}
		onclick={onToggleDeafen}
		aria-label={deafened ? t('meet.undeafen') : t('meet.deafen')}
	>
		<Icon name={deafened ? 'volume-mute-line' : 'headphone-line'} size={20} />
	</button>
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
			aria-label={micEnabled ? t('meet.micOn') : t('meet.micOff')}
		>
			<Icon name={micEnabled ? 'mic-line' : 'mic-off-line'} size={20} />
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
		>
			<Icon name={cameraEnabled ? 'camera-line' : 'camera-off-line'} size={20} />
		</button>
	</div>
	{#if screenShareSupported}
		<button
			type="button"
			class="call-btn"
			class:call-btn-active={screenShareEnabled}
			onclick={onToggleScreenShare}
			aria-label={screenShareEnabled ? t('meet.screenShareOff') : t('meet.screenShareOn')}
		>
			<Icon name="computer-line" size={20} />
		</button>
	{/if}
	{#if pipSupported}
		<button
			type="button"
			class="call-btn"
			class:call-btn-active={pipActive}
			onclick={onTogglePip}
			aria-label={pipActive ? t('meet.pipOff') : t('meet.pipOn')}
		>
			<Icon name={pipActive ? 'picture-in-picture-exit-line' : 'picture-in-picture-2-line'} size={20} />
		</button>
	{/if}
	<button
		type="button"
		class="call-btn"
		class:call-btn-active={panel === 'participants'}
		onclick={() => onTogglePanel('participants')}
		aria-label={t('meet.participants')}
	>
		<Icon name="group-line" size={20} />
		{#if rosterCount > 0}<span class="call-btn-badge">{rosterCount}</span>{/if}
	</button>
	<button
		type="button"
		class="call-btn"
		class:call-btn-active={panel === 'chat'}
		onclick={() => onTogglePanel('chat')}
		aria-label={t('meet.chat')}
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
		>
			<Icon name="settings-3-line" size={20} />
			{#if pendingAdmissionsCount > 0}<span class="call-btn-badge">{pendingAdmissionsCount}</span>{/if}
		</button>
	{/if}
	<button type="button" class="call-btn call-btn-leave" onclick={onLeave} aria-label={t('meet.leave')}>
		<Icon name="phone-line" size={20} />
	</button>
</div>

<style>
	.call-controls {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
		padding-bottom: 0.5rem;
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

	/* Same warning color as a muted mic/camera — deafened means you can't speak or hear either. */
	.call-btn-danger-active {
		background: #7f1d1d;
	}

	.call-btn-danger-active:hover {
		background: #932222;
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
