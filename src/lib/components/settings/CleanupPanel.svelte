<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { SWEEP_AGE_CHOICES, TRASH_RETENTION_CHOICES } from '$lib/cleanup-options';

	type CleanupSettings = {
		trashRetentionDays: number;
		sweep: { auto: boolean; olderThanDays: number; onlyRead: boolean; keepStarred: boolean };
	};

	let { settings: initial }: { settings: CleanupSettings } = $props();

	/** What's stored. The form edits copies, and nothing changes until Save. */
	let saved = $state(untrack(() => $state.snapshot(initial)));
	let retention = $state(untrack(() => initial.trashRetentionDays));
	let autoSweep = $state(untrack(() => initial.sweep.auto));
	let olderThanDays = $state(untrack(() => initial.sweep.olderThanDays));
	let onlyRead = $state(untrack(() => initial.sweep.onlyRead));
	let keepStarred = $state(untrack(() => initial.sweep.keepStarred));

	const dirty = $derived(
		retention !== saved.trashRetentionDays ||
			autoSweep !== saved.sweep.auto ||
			olderThanDays !== saved.sweep.olderThanDays ||
			onlyRead !== saved.sweep.onlyRead ||
			keepStarred !== saved.sweep.keepStarred
	);

	let count = $state<number | null>(null);
	let counting = $state(false);
	let busy = $state(false);
	let saving = $state(false);
	let error = $state('');
	let notice = $state('');
	/** Cleared whenever the filter changes, so a stale count is never acted on. */
	let confirming = $state(false);

	function describe(days: number): string {
		if (days === 0) return t('cleanup.never');
		if (days === 365) return t('cleanup.afterYear');
		return t('cleanup.afterDays', { days });
	}

	async function preview() {
		counting = true;
		error = '';
		notice = '';
		try {
			const params = new URLSearchParams({
				olderThanDays: String(olderThanDays),
				onlyRead: onlyRead ? '1' : '0',
				keepStarred: keepStarred ? '1' : '0'
			});
			const res = await fetch(`/api/settings/cleanup?${params}`);
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not count those messages';
				return;
			}
			count = body.count;
			confirming = true;
		} catch {
			error = t('common.networkError');
		} finally {
			counting = false;
		}
	}

	async function post(payload: Record<string, unknown>) {
		busy = true;
		error = '';
		notice = '';
		try {
			const res = await fetch('/api/settings/cleanup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Something went wrong';
				return null;
			}
			return body;
		} catch {
			error = t('common.networkError');
			return null;
		} finally {
			busy = false;
		}
	}

	async function sweep() {
		const body = await post({ action: 'sweep', olderThanDays, onlyRead, keepStarred });
		if (!body) return;
		notice = t(body.moved === 1 ? 'cleanup.movedOne' : 'cleanup.movedMany', {
			count: body.moved
		});
		count = null;
		confirming = false;
		await invalidateAll();
	}

	async function save() {
		saving = true;
		const body = await post({
			action: 'settings',
			trashRetentionDays: retention,
			sweep: { auto: autoSweep, olderThanDays, onlyRead, keepStarred }
		});
		saving = false;
		if (!body) return;
		saved = { trashRetentionDays: body.trashRetentionDays, sweep: body.sweep };
		notice = t('cleanup.saved');
	}

	async function emptyExpired() {
		const body = await post({ action: 'empty-expired' });
		if (!body) return;
		notice =
			body.removed === 0
				? t('cleanup.nothingExpired')
				: t(body.removed === 1 ? 'cleanup.removedOne' : 'cleanup.removedMany', { count: body.removed });
		await invalidateAll();
	}

	/** Any change to the filter invalidates the number on screen. */
	function resetCount() {
		count = null;
		confirming = false;
	}
</script>

<section class="surface-lg card">
	<h2><Icon name="brush-line" size={18} /> {t('cleanup.title')}</h2>

	<p class="card-hint">{t('cleanup.hint')}</p>

	<div class="block">
		<label class="field-title" for="retention">{t('cleanup.autoEmpty')}</label>
		<select id="retention" class="text-input" bind:value={retention}>
			{#each TRASH_RETENTION_CHOICES as days (days)}
				<option value={days}>{describe(days)}</option>
			{/each}
		</select>
		<p class="hint">{t('cleanup.autoEmptyHint')}</p>
		<div class="actions">
			{#if retention !== saved.trashRetentionDays}<span class="hint">{t('cleanup.saveFirst')}</span>{/if}
			<button
				type="button"
				class="btn-ghost"
				disabled={busy || retention !== saved.trashRetentionDays || saved.trashRetentionDays === 0}
				onclick={emptyExpired}
			>
				{t('cleanup.emptyExpiredNow')}
			</button>
		</div>
	</div>

	<div class="block">
		<span class="field-title">{t('cleanup.moveOld')}</span>

		<div class="row">
			<select
				class="text-input"
				bind:value={olderThanDays}
				onchange={resetCount}
				aria-label={t('cleanup.olderThan')}
			>
				{#each SWEEP_AGE_CHOICES as days (days)}
					<option value={days}>{t('cleanup.olderThanDays', { days })}</option>
				{/each}
			</select>
		</div>

		<label class="check">
			<input type="checkbox" bind:checked={onlyRead} onchange={resetCount} />
			<span>{t('cleanup.onlyRead')}</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={keepStarred} onchange={resetCount} />
			<span>{t('cleanup.keepStarred')}</span>
		</label>

		<label class="check auto">
			<input type="checkbox" bind:checked={autoSweep} />
			<span>{t('cleanup.autoSweep')}</span>
		</label>
		<p class="hint">{t('cleanup.autoSweepHint')}</p>

		<p class="hint once">{t('cleanup.moveNowHint')}</p>
		{#if confirming && count !== null}
			<p class="count">
				{count === 0
					? t('cleanup.nothingMatches')
					: t(count === 1 ? 'cleanup.matchCount' : 'cleanup.matchCountPlural', { count })}
			</p>
		{/if}

		<div class="actions">
			{#if confirming && count !== null && count > 0}
				<button type="button" class="btn-ghost" onclick={resetCount}>{t('common.cancel')}</button>
				<button type="button" class="btn-primary" disabled={busy} onclick={sweep}>
					{busy ? t('cleanup.moving') : t('cleanup.moveToTrash', { count })}
				</button>
			{:else}
				<button type="button" class="btn-primary" disabled={counting} onclick={preview}>
					{counting ? t('cleanup.checking') : t('cleanup.checkHowMany')}
				</button>
			{/if}
		</div>
	</div>

	{#if error}<p class="error">{error}</p>{/if}
	{#if notice}<p class="saved">{notice}</p>{/if}

	<div class="save-row">
		{#if dirty}<span class="hint">{t('cleanup.unsaved')}</span>{/if}
		<button type="button" class="btn-primary" disabled={!dirty || saving} onclick={save}>
			{saving ? t('cleanup.saving') : t('cleanup.save')}
		</button>
	</div>
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

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 1.125rem;
		padding-top: 1.125rem;
		border-top: 1px solid var(--color-line);
	}

	.row {
		display: flex;
		gap: 0.5rem;
	}

	.hint {
		margin: 0.125rem 0 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.check.auto {
		margin-top: 0.75rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.hint.once {
		margin-top: 0.75rem;
	}

	.save-row {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1.125rem;
		padding-top: 1.125rem;
		border-top: 1px solid var(--color-line);
	}

	.save-row .hint {
		margin: 0;
	}

	.count {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
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
