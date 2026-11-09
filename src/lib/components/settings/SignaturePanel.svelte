<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '../Icon.svelte';
	import SignatureEditor from './SignatureEditor.svelte';
	import { t } from '$lib/i18n';

	let { signature: initialSignature }: { signature: string } = $props();

	let signature = $state(untrack(() => initialSignature));
	let signatureBusy = $state(false);
	let signatureError = $state('');
	let signatureSaved = $state(false);

	async function saveSignature(event: SubmitEvent) {
		event.preventDefault();
		signatureBusy = true;
		signatureError = '';
		signatureSaved = false;

		try {
			const res = await fetch('/api/settings/signature', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signature })
			});
			const body = await res.json();
			if (!res.ok) {
				signatureError = body.error ?? 'Could not save signature';
				return;
			}

			signature = body.signature;
			signatureSaved = true;
		} catch {
			signatureError = t('common.networkError');
		} finally {
			signatureBusy = false;
		}
	}
</script>

<section class="surface-lg card">
	<h2><Icon name="pencil-line" size={18} /> Signature</h2>
	<p class="card-hint">{t('settings.signatureHint')}</p>

	<form class="signature-form" onsubmit={saveSignature}>
		<SignatureEditor bind:html={signature} label={t('settings.signature')} placeholder={t('settings.signaturePasteHint')} />

		<div class="signature-actions">
			<button type="submit" class="btn-primary" disabled={signatureBusy}>
				{signatureBusy ? t('common.saving') : t('common.save')}
			</button>
		</div>

		{#if signatureError}<p class="error">{signatureError}</p>{/if}
		{#if signatureSaved}<p class="saved">{t('common.saved')}</p>{/if}
	</form>
</section>

<style>
	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	.card h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.card-hint {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.signature-form {
		margin-top: 1rem;
	}

	.signature-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.saved {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--tone-good-fg);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}
</style>
