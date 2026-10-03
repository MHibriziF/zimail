<script lang="ts">
	import { t } from '$lib/i18n';
	import { dismissOutgoing, isSendPending, outgoing, undoSend } from '$lib/mail/undo-send';

	function onBeforeUnload(event: BeforeUnloadEvent) {
		if (!isSendPending()) return;
		event.preventDefault();
		event.returnValue = t('compose.undoLeaveWarning');
	}
</script>

<svelte:window onbeforeunload={onBeforeUnload} />

{#if $outgoing}
	<div class="send-toast" role="status" aria-live="polite">
		{#if $outgoing.phase === 'holding'}
			<span>{t('compose.undoSending')}</span>
			<button type="button" class="send-toast-action" onclick={undoSend}>{t('compose.undoAction')}</button>
		{:else if $outgoing.phase === 'sending'}
			<span>{t('compose.undoSending')}</span>
		{:else if $outgoing.phase === 'sent'}
			<span>{t('compose.undoSent')}</span>
			{#if $outgoing.viewHref}
				<a class="send-toast-action" href={$outgoing.viewHref} onclick={dismissOutgoing}>{t('compose.undoView')}</a>
			{/if}
		{:else}
			<span>{t('compose.undoFailed')}</span>
		{/if}
		{#if $outgoing.phase === 'sent' || $outgoing.phase === 'failed'}
			<button type="button" class="send-toast-close" aria-label={t('common.close')} onclick={dismissOutgoing}>×</button>
		{/if}
	</div>
{/if}

<style>
	.send-toast {
		position: fixed;
		left: 1.25rem;
		bottom: 1.25rem;
		z-index: 70;
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 3rem;
		max-width: calc(100vw - 2rem);
		padding: 0.5rem 0.75rem 0.5rem 1rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-surface);
		background: var(--color-text);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.24);
	}

	.send-toast-action {
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		font-weight: 600;
		color: inherit;
		text-decoration: none;
	}

	.send-toast-action:hover {
		background: color-mix(in srgb, var(--color-surface) 16%, transparent);
	}

	.send-toast-close {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		font-size: 1.125rem;
		color: inherit;
		opacity: 0.7;
	}

	.send-toast-close:hover {
		opacity: 1;
	}

	@media (max-width: 900px) {
		.send-toast {
			left: 1rem;
			right: 1rem;
			bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + 0.75rem);
		}

		.send-toast span {
			flex: 1;
		}
	}
</style>
