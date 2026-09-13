<script lang="ts">
	import Icon from '../Icon.svelte';
	import SchedulePicker from './SchedulePicker.svelte';
	import { t } from '$lib/i18n';

	/**
	 * Send now, or schedule. Shared by the composer and the reply box so the two
	 * cannot drift — the caret is joined to Send rather than floating beside it,
	 * so it reads as a menu on that button.
	 */
	let {
		sending = false,
		disabled = false,
		label = '',
		showIcon = false,
		timeZone = null,
		onsend
	}: {
		sending?: boolean;
		disabled?: boolean;
		label?: string;
		showIcon?: boolean;
		timeZone?: string | null;
		onsend: (scheduledAt: string | null) => void;
	} = $props();

	let scheduleOpen = $state(false);
</script>

<div class="send-split">
	<button
		type="button"
		class="btn-primary send-main"
		disabled={sending || disabled}
		onclick={() => onsend(null)}
	>
		{#if showIcon}<Icon name="send-plane-2-fill" size={16} />{/if}
		{sending ? t('common.sending') : label || t('common.send')}
	</button>
	<button
		type="button"
		class="btn-primary send-more"
		disabled={sending || disabled}
		aria-label={t('compose.scheduleSend')}
		onclick={() => (scheduleOpen = true)}
	>
		<Icon name="arrow-down-s-line" size={16} />
	</button>
</div>

<SchedulePicker bind:open={scheduleOpen} {timeZone} onpick={(iso) => onsend(iso)} />

<style>
	.send-split {
		display: inline-flex;
		align-items: stretch;
		gap: 1px;
	}

	.send-main {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.send-more {
		padding-left: 0.5rem;
		padding-right: 0.5rem;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}
</style>
