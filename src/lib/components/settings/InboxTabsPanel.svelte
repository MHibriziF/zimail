<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';

	let enabled = $state(true);
	let loaded = $state(false);
	let busy = $state(false);
	let sorting = $state(false);
	let sorted = $state(0);
	let remaining = $state<number | null>(null);
	let error = $state('');

	async function post(body: unknown): Promise<Record<string, unknown>> {
		const response = await fetch('/api/settings/inbox-tabs', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
		if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : t('common.networkError'));
		return payload;
	}

	onMount(async () => {
		try {
			const response = await fetch('/api/settings/inbox-tabs');
			const body = (await response.json()) as { enabled?: boolean };
			enabled = body.enabled !== false;
		} catch {
			// Keep the default; the switch still works.
		} finally {
			loaded = true;
		}
	});

	async function toggle() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await post({ enabled: !enabled });
			enabled = !enabled;
			await invalidateAll();
		} catch (failure) {
			error = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			busy = false;
		}
	}

	/** One batch per request, so no single call runs long; loop until nothing's left. */
	async function sortExisting() {
		if (sorting) return;
		sorting = true;
		sorted = 0;
		error = '';
		try {
			for (;;) {
				const result = (await post({ backfill: true })) as { sorted: number; remaining: number };
				sorted += result.sorted;
				remaining = result.remaining;
				if (result.remaining === 0 || result.sorted === 0) break;
			}
			await invalidateAll();
		} catch (failure) {
			error = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			sorting = false;
		}
	}
</script>

<section class="surface-lg card" id="inbox-tabs">
	<h2><Icon name="layout-top-line" size={18} /> {t('tabs.settingsTitle')}</h2>
	<p class="card-hint">{t('tabs.settingsHint')}</p>

	<label class="switch-row">
		<input type="checkbox" checked={enabled} disabled={!loaded || busy} onchange={toggle} />
		<span>{t('tabs.enable')}</span>
	</label>

	{#if enabled}
		<div class="backfill">
			<button type="button" class="btn-ghost" disabled={sorting} onclick={sortExisting}>
				<Icon name="sort-desc" size={16} />
				{sorting ? t('tabs.sorting', { count: sorted }) : t('tabs.sortExisting')}
			</button>
			{#if !sorting && remaining === 0}
				<span class="done">{t('tabs.sortDone', { count: sorted })}</span>
			{/if}
		</div>
		<p class="card-hint">{t('tabs.sortHint')}</p>
	{/if}

	{#if error}<p class="error" role="alert">{error}</p>{/if}
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

	.switch-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		margin-top: 0.875rem;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.backfill {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.875rem;
	}

	.done {
		font-size: 0.8125rem;
		color: var(--color-accent-text);
	}

	.error {
		margin: 0.625rem 0 0;
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
