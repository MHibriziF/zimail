<script lang="ts">
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';

	let {
		requireApproval,
		settingsBusy,
		settingsError,
		pendingAdmissions,
		admissionsBusyId,
		onSetAdmissionMode,
		onRespondToAdmission,
		onClose
	}: {
		requireApproval: boolean;
		settingsBusy: boolean;
		settingsError: string;
		pendingAdmissions: { id: string; name: string }[];
		admissionsBusyId: string;
		onSetAdmissionMode: (next: boolean) => void;
		onRespondToAdmission: (admissionId: string, action: 'admit' | 'deny') => void;
		onClose: () => void;
	} = $props();
</script>

<div class="call-panel">
	<div class="call-panel-head">
		<strong>{t('meet.settings')}</strong>
		<button type="button" class="call-panel-close" onclick={onClose} aria-label={t('meet.close')}>
			<Icon name="close-line" size={18} />
		</button>
	</div>
	<div class="call-settings-body">
		<fieldset class="call-settings-field">
			<legend>{t('meetings.admissionLabel')}</legend>
			<label class="call-settings-radio">
				<input
					type="radio"
					name="call-admission"
					checked={!requireApproval}
					disabled={settingsBusy}
					onchange={() => onSetAdmissionMode(false)}
				/>
				{t('meetings.admissionOpen')}
			</label>
			<label class="call-settings-radio">
				<input
					type="radio"
					name="call-admission"
					checked={requireApproval}
					disabled={settingsBusy}
					onchange={() => onSetAdmissionMode(true)}
				/>
				{t('meetings.admissionApproval')}
			</label>
		</fieldset>

		{#if settingsError}<p class="call-settings-error">{settingsError}</p>{/if}

		{#if requireApproval}
			<div class="call-settings-field">
				<span class="call-settings-label">{t('meet.waitingToJoin')}</span>
				{#if pendingAdmissions.length === 0}
					<p class="call-settings-empty">{t('meet.noOneWaiting')}</p>
				{:else}
					<ul class="call-panel-list">
						{#each pendingAdmissions as admission (admission.id)}
							<li class="call-admission-row">
								<span>{admission.name}</span>
								<div class="call-admission-actions">
									<button
										type="button"
										class="call-admission-btn"
										disabled={admissionsBusyId === admission.id}
										onclick={() => onRespondToAdmission(admission.id, 'deny')}
										aria-label={t('meet.deny')}
									>
										<Icon name="close-line" size={16} />
									</button>
									<button
										type="button"
										class="call-admission-btn call-admission-admit"
										disabled={admissionsBusyId === admission.id}
										onclick={() => onRespondToAdmission(admission.id, 'admit')}
										aria-label={t('meet.admit')}
									>
										<Icon name="check-line" size={16} />
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.call-panel {
		display: flex;
		flex-direction: column;
		width: 300px;
		flex-shrink: 0;
		border-radius: 0.75rem;
		background: #17171a;
		overflow: hidden;
	}

	.call-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		font-size: 0.875rem;
	}

	.call-panel-close {
		display: flex;
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
	}

	.call-panel-list {
		flex: 1;
		list-style: none;
		margin: 0;
		padding: 0.5rem;
		overflow-y: auto;
	}

	.call-settings-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.75rem;
		overflow-y: auto;
	}

	.call-settings-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: none;
	}

	.call-settings-field legend,
	.call-settings-label {
		padding: 0;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: rgba(255, 255, 255, 0.5);
	}

	.call-settings-radio {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
	}

	.call-settings-error {
		margin: 0;
		font-size: 0.75rem;
		color: #f87171;
	}

	.call-settings-empty {
		margin: 0;
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.5);
	}

	.call-admission-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.5rem 0.5rem;
		font-size: 0.8125rem;
		border-radius: 0.5rem;
	}

	.call-admission-row:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.call-admission-actions {
		display: flex;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.call-admission-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		cursor: pointer;
	}

	.call-admission-btn:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.call-admission-admit {
		background: #15803d;
	}

	.call-admission-admit:hover {
		background: #16a34a;
	}

	@media (max-width: 640px) {
		.call-panel {
			width: 100%;
			max-height: 45vh;
		}
	}
</style>
