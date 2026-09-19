<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import {
		LABEL_COLORS,
		LABEL_SWATCH,
		MAX_LABEL_NAME_LENGTH,
		type Label,
		type LabelColor
	} from '$lib/mail/labels';
	import { createLabel, deleteLabel, describeMailError, updateLabel } from '$lib/mail/client';

	const labels = $derived(($page.data.labels ?? []) as Label[]);

	let newName = $state('');
	let newColor = $state<LabelColor>('blue');
	let busy = $state(false);
	let error = $state('');
	let editingId = $state('');
	let editName = $state('');
	let confirmDeleteId = $state('');

	async function run(action: () => Promise<unknown>) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await action();
			// The sidebar, row chips and pickers all read labels from the layout load.
			await invalidate('app:labels');
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
		} finally {
			busy = false;
		}
	}

	function create(event: SubmitEvent) {
		event.preventDefault();
		if (!newName.trim()) return;
		void run(async () => {
			await createLabel({ name: newName, color: newColor });
			newName = '';
		});
	}

	function startRename(label: Label) {
		editingId = label.id;
		editName = label.name;
		confirmDeleteId = '';
	}

	function saveRename(event: SubmitEvent, label: Label) {
		event.preventDefault();
		void run(async () => {
			await updateLabel(label.id, { name: editName });
			editingId = '';
		});
	}

	function recolor(label: Label, color: LabelColor) {
		void run(() => updateLabel(label.id, { color }));
	}

	function remove(label: Label) {
		void run(async () => {
			await deleteLabel(label.id);
			confirmDeleteId = '';
		});
	}
</script>

<section class="surface-lg card" id="labels">
	<h2><Icon name="price-tag-3-line" size={18} /> {t('labels.title')}</h2>
	<p class="card-hint">{t('labels.settingsHint')}</p>

	<form class="create" onsubmit={create}>
		<input
			class="text-input"
			type="text"
			bind:value={newName}
			maxlength={MAX_LABEL_NAME_LENGTH}
			placeholder={t('labels.newName')}
			aria-label={t('labels.newName')}
		/>
		<div class="swatches" role="radiogroup" aria-label={t('labels.color')}>
			{#each LABEL_COLORS as color (color)}
				<button
					type="button"
					class="swatch"
					class:selected={newColor === color}
					style="--swatch: {LABEL_SWATCH[color]}"
					role="radio"
					aria-checked={newColor === color}
					aria-label={t(`labels.colors.${color}`)}
					onclick={() => (newColor = color)}
				></button>
			{/each}
		</div>
		<button type="submit" class="btn-primary" disabled={busy || !newName.trim()}>{t('labels.add')}</button>
	</form>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if labels.length === 0}
		<p class="empty">{t('labels.emptySettings')}</p>
	{:else}
		<ul class="list">
			{#each labels as label (label.id)}
				<li class="row">
					{#if editingId === label.id}
						<form class="rename" onsubmit={(event) => saveRename(event, label)}>
							<input class="text-input" type="text" bind:value={editName} maxlength={MAX_LABEL_NAME_LENGTH} aria-label={t('labels.rename')} />
							<button type="button" class="btn-ghost" onclick={() => (editingId = '')}>{t('common.cancel')}</button>
							<button type="submit" class="btn-primary" disabled={busy}>{t('common.save')}</button>
						</form>
					{:else}
						<span class="dot" style="background: {LABEL_SWATCH[label.color]}"></span>
						<a class="name" href="/all?label={label.id}">{label.name}</a>
						<div class="swatches compact" role="radiogroup" aria-label={t('labels.color')}>
							{#each LABEL_COLORS as color (color)}
								<button
									type="button"
									class="swatch"
									class:selected={label.color === color}
									style="--swatch: {LABEL_SWATCH[color]}"
									role="radio"
									aria-checked={label.color === color}
									aria-label={t(`labels.colors.${color}`)}
									disabled={busy}
									onclick={() => recolor(label, color)}
								></button>
							{/each}
						</div>
						{#if confirmDeleteId === label.id}
							<span class="confirm">
								{t('labels.deleteConfirm')}
								<button type="button" class="btn-ghost" onclick={() => (confirmDeleteId = '')}>{t('common.cancel')}</button>
								<button type="button" class="btn-ghost danger" disabled={busy} onclick={() => remove(label)}>{t('labels.delete')}</button>
							</span>
						{:else}
							<button type="button" class="icon-btn" aria-label={t('labels.rename')} title={t('labels.rename')} onclick={() => startRename(label)}>
								<Icon name="pencil-line" size={15} />
							</button>
							<button
								type="button"
								class="icon-btn"
								aria-label={t('labels.delete')}
								title={t('labels.delete')}
								onclick={() => {
									confirmDeleteId = label.id;
									editingId = '';
								}}
							>
								<Icon name="delete-bin-line" size={15} />
							</button>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
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

	.text-input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
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

	.create {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		margin-top: 0.875rem;
	}

	.swatches {
		display: flex;
		gap: 0.3125rem;
	}

	.swatch {
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 999px;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
	}

	.swatches.compact .swatch {
		width: 0.875rem;
		height: 0.875rem;
	}

	.swatch.selected {
		box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--swatch);
	}

	.error {
		margin: 0.625rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.empty {
		margin: 1rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.list {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		min-height: 2.75rem;
		padding: 0.25rem 0;
		flex-wrap: wrap;
	}

	.row + .row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.dot {
		flex-shrink: 0;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 999px;
	}

	.name {
		flex: 1;
		min-width: 6rem;
		overflow: hidden;
		font-size: 0.875rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text);
		text-decoration: none;
	}

	.name:hover {
		text-decoration: underline;
	}

	.rename {
		display: flex;
		flex: 1;
		gap: 0.5rem;
	}

	.confirm {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.danger {
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
