<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { detectTimeZone } from '$lib/timezone';

	let { timeZone: initial }: { timeZone: string | null } = $props();

	let saved = $state(untrack(() => initial));
	let choice = $state(untrack(() => initial ?? ''));
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	const detected = detectTimeZone();

	/** Every zone the browser knows, so the list is never out of date. */
	const zones = (() => {
		try {
			const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
				.supportedValuesOf?.('timeZone');
			if (all?.length) return all;
		} catch {
			// Older engines: fall back to what we can name for certain.
		}
		return [detected, 'UTC'].filter((zone, index, list) => list.indexOf(zone) === index);
	})();

	const example = $derived.by(() => {
		const zone = choice || detected;
		try {
			return new Intl.DateTimeFormat(undefined, {
				timeZone: zone,
				weekday: 'short',
				hour: 'numeric',
				minute: '2-digit'
			}).format(new Date());
		} catch {
			return '';
		}
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		notice = '';
		try {
			const res = await fetch('/api/settings/timezone', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ timeZone: choice || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? t('timezone.couldNotSave');
				return;
			}
			saved = body.timeZone;
			notice = saved
				? t('timezone.nowShownIn', { zone: saved.replace('_', ' ') })
				: t('timezone.followingDevice');
			await invalidateAll();
		} catch {
			error = t('common.networkError');
		} finally {
			busy = false;
		}
	}
</script>

<section class="surface-lg card">
	<h2><Icon name="time-line" size={18} /> {t('timezone.title')}</h2>

	<p class="card-hint">{t('timezone.hint')}</p>

	<form class="stack" onsubmit={save}>
		<label class="field-title" for="timezone">{t('timezone.label')}</label>
		<select id="timezone" class="text-input" bind:value={choice}>
			<option value="">{t('timezone.followDevice', { zone: detected.replace('_', ' ') })}</option>
			{#each zones as zone (zone)}
				<option value={zone}>{zone.replace('_', ' ')}</option>
			{/each}
		</select>

		{#if example}
			<p class="hint">{t('timezone.currently', { time: example })}</p>
		{/if}

		<div class="actions">
			<button type="submit" class="btn-primary" disabled={busy || choice === (saved ?? '')}>
				{busy ? t('common.saving') : t('common.save')}
			</button>
		</div>
	</form>

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="saved">{notice}</p>{/if}
</section>

<style>
	/* Page-scoped elsewhere in this codebase, so redeclared here. */
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

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}

	.card-hint {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.875rem;
	}

	.field-title {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.text-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.hint {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.75rem;
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.saved {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-accent-text);
	}
</style>
