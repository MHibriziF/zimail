<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import { LABEL_SWATCH, MAX_LABEL_NAME_LENGTH, normalizeLabelName, type Label } from '$lib/mail/labels';
	import { createLabel, describeMailError, setConversationLabels } from '$lib/mail/client';

	let {
		emailId,
		labels,
		applied,
		onchange,
		buttonClass = 'icon-btn'
	}: {
		/** Any message in the conversation — labels apply to the whole conversation. */
		emailId: string;
		/** Every label the user has. */
		labels: Label[];
		applied: Label[];
		onchange?: (applied: Label[]) => void;
		/** Lets each theme's toolbar style the trigger like its own buttons. */
		buttonClass?: string;
	} = $props();

	let open = $state(false);
	let busy = $state(false);
	let error = $state('');
	let query = $state('');
	let root = $state<HTMLDivElement>();

	const appliedIds = $derived(new Set(applied.map((label) => label.id)));
	const matches = $derived(
		labels.filter((label) => label.name.toLowerCase().includes(query.trim().toLowerCase()))
	);
	const canCreate = $derived(
		Boolean(normalizeLabelName(query)) &&
			!labels.some((label) => label.name.toLowerCase() === normalizeLabelName(query)?.toLowerCase())
	);

	async function save(ids: string[]) {
		busy = true;
		error = '';
		try {
			onchange?.(await setConversationLabels(emailId, ids));
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
		} finally {
			busy = false;
		}
	}

	function toggle(label: Label) {
		if (busy) return;
		const ids = appliedIds.has(label.id)
			? applied.filter((entry) => entry.id !== label.id).map((entry) => entry.id)
			: [...applied.map((entry) => entry.id), label.id];
		void save(ids);
	}

	/** Creates the typed label and applies it in one go. */
	async function createAndApply(event?: Event) {
		event?.preventDefault();
		if (busy || !canCreate) return;
		busy = true;
		error = '';
		try {
			const label = await createLabel({ name: query, color: 'gray' });
			query = '';
			// The sidebar lists labels from the layout load.
			void invalidate('app:labels');
			busy = false;
			await save([...applied.map((entry) => entry.id), label.id]);
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
			busy = false;
		}
	}

	function onDocumentPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:document onpointerdown={onDocumentPointer} />

<div class="label-picker" bind:this={root}>
	<button
		type="button"
		class={buttonClass}
		aria-label={t('labels.apply')}
		title={t('labels.apply')}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="price-tag-3-line" size={16} />
	</button>

	{#if open}
		<div class="label-menu" role="dialog" aria-label={t('labels.apply')}>
			<form class="label-search" onsubmit={createAndApply}>
				<input
					type="text"
					bind:value={query}
					maxlength={MAX_LABEL_NAME_LENGTH}
					placeholder={t('labels.searchOrCreate')}
					aria-label={t('labels.searchOrCreate')}
				/>
			</form>

			<ul class="label-options">
				{#each matches as label (label.id)}
					<li>
						<label class="label-option">
							<input type="checkbox" checked={appliedIds.has(label.id)} disabled={busy} onchange={() => toggle(label)} />
							<span class="label-dot" style="background: {LABEL_SWATCH[label.color]}"></span>
							<span class="label-name">{label.name}</span>
						</label>
					</li>
				{/each}
				{#if matches.length === 0 && !canCreate}
					<li class="label-empty">{t('labels.none')}</li>
				{/if}
			</ul>

			{#if canCreate}
				<button type="button" class="label-create" disabled={busy} onclick={() => void createAndApply()}>
					<Icon name="add-line" size={14} />
					{t('labels.create', { name: normalizeLabelName(query) ?? '' })}
				</button>
			{/if}

			{#if error}<p class="label-error">{error}</p>{/if}

			<a class="label-manage" href="/settings/labels">{t('labels.manage')}</a>
		</div>
	{/if}
</div>

<style>
	.label-picker {
		position: relative;
		display: inline-flex;
	}

	.label-menu {
		position: absolute;
		top: calc(100% + 0.375rem);
		right: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		width: 15rem;
		padding: 0.5rem;
		border-radius: 0.75rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.15)), inset 0 0 0 1px var(--color-line);
	}

	.label-search input {
		width: 100%;
		padding: 0.4375rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.label-search input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line);
	}

	.label-options {
		max-height: 14rem;
		margin: 0.375rem 0 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
	}

	.label-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.label-option:hover {
		background: var(--color-surface-hover);
	}

	.label-dot {
		flex-shrink: 0;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 999px;
	}

	.label-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.label-empty,
	.label-error {
		margin: 0;
		padding: 0.375rem 0.5rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.label-error {
		color: var(--color-danger);
	}

	.label-create {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		text-align: left;
		color: var(--color-accent-text);
	}

	.label-create:hover:not(:disabled) {
		background: var(--color-accent-soft);
	}

	.label-manage {
		margin-top: 0.25rem;
		padding: 0.375rem 0.5rem 0.125rem;
		border-top: 1px solid var(--color-line);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		text-decoration: none;
	}

	.label-manage:hover {
		color: var(--color-text);
	}
</style>
