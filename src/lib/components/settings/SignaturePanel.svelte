<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { MAX_EMAIL_SIGNATURE_LENGTH } from '$lib/email-signature';

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
		<textarea
			id="email-signature"
			bind:value={signature}
			maxlength={MAX_EMAIL_SIGNATURE_LENGTH}
			rows="3"
			placeholder={'Best,\nEmmanuel'}
			class="signature-input"
		></textarea>

		<div class="signature-actions">
			<span class="character-count">{signature.length}/{MAX_EMAIL_SIGNATURE_LENGTH}</span>
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

	.signature-input {
		width: 100%;
		padding: 0.75rem 0.875rem;
		resize: vertical;
		border-radius: 0.75rem;
		font-size: 0.875rem;
		line-height: 1.55;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.signature-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.signature-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.character-count {
		font-size: 0.75rem;
		color: var(--color-muted);
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
