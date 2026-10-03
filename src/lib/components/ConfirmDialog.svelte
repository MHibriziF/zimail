<script lang="ts">
	import { t } from '$lib/i18n';

	let {
		open,
		title,
		message,
		confirmLabel,
		onConfirm,
		onCancel
	}: {
		open: boolean;
		title: string;
		message: string;
		confirmLabel: string;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	class="confirm"
	aria-labelledby="confirm-title"
	aria-describedby="confirm-message"
	oncancel={(event) => {
		event.preventDefault();
		onCancel();
	}}
	onclick={(event) => {
		if (event.target === dialog) onCancel();
	}}
	onkeydown={(event) => event.stopPropagation()}
>
	<div class="body">
		<h2 id="confirm-title">{title}</h2>
		<p id="confirm-message">{message}</p>
		<div class="actions">
			<button type="button" class="btn" onclick={onCancel}>{t('common.cancel')}</button>
			<button type="button" class="btn btn-danger" onclick={onConfirm}>{confirmLabel}</button>
		</div>
	</div>
</dialog>

<style>
	.confirm {
		width: min(24rem, calc(100vw - 2rem));
		padding: 0;
		border: none;
		border-radius: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: 0 0 0 1px var(--color-line), 0 16px 48px rgba(0, 0, 0, 0.24);
	}

	.confirm::backdrop {
		background: rgba(0, 0, 0, 0.4);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.25rem;
	}

	h2 {
		font-size: 1rem;
		font-weight: 600;
	}

	p {
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.btn {
		min-height: 2.25rem;
		padding: 0 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.btn:hover {
		background: var(--color-surface-muted);
	}

	.btn-danger {
		color: #fff;
		background: var(--color-danger);
		box-shadow: none;
	}

	.btn-danger:hover {
		background: var(--color-danger);
		filter: brightness(0.92);
	}
</style>
