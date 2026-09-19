<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import { MAIL_CATEGORIES, type MailCategory } from '$lib/mail/categories';
	import { describeMailError, patchThread } from '$lib/mail/client';

	let {
		emailId,
		current,
		onchange,
		buttonClass = 'icon-btn'
	}: {
		/** Any message in the conversation — it moves as a whole. */
		emailId: string;
		current: MailCategory;
		onchange?: (category: MailCategory) => void;
		buttonClass?: string;
	} = $props();

	let open = $state(false);
	let busy = $state(false);
	let error = $state('');
	let root = $state<HTMLDivElement>();

	async function move(category: MailCategory) {
		if (busy || category === current) {
			open = false;
			return;
		}
		busy = true;
		error = '';
		try {
			await patchThread(emailId, { category });
			open = false;
			onchange?.(category);
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
		} finally {
			busy = false;
		}
	}

	function onDocumentPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:document onpointerdown={onDocumentPointer} />

<div class="category-menu" bind:this={root}>
	<button
		type="button"
		class={buttonClass}
		aria-label={t('tabs.moveTo')}
		title={t('tabs.moveTo')}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="folder-transfer-line" size={16} />
	</button>

	{#if open}
		<div class="category-options" role="menu" aria-label={t('tabs.moveTo')}>
			<p class="category-title">{t('tabs.moveTo')}</p>
			{#each MAIL_CATEGORIES as category (category)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={category === current}
					class="category-option"
					disabled={busy}
					onclick={() => move(category)}
				>
					<span class="category-check">{#if category === current}<Icon name="check-line" size={14} />{/if}</span>
					{t(`tabs.${category}`)}
				</button>
			{/each}
			<p class="category-hint">{t('tabs.moveHint')}</p>
			{#if error}<p class="category-error">{error}</p>{/if}
		</div>
	{/if}
</div>

<style>
	.category-menu {
		position: relative;
		display: inline-flex;
	}

	.category-options {
		position: absolute;
		top: calc(100% + 0.375rem);
		right: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		width: 14rem;
		padding: 0.375rem;
		border-radius: 0.75rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.15)), inset 0 0 0 1px var(--color-line);
	}

	.category-title,
	.category-hint,
	.category-error {
		margin: 0;
		padding: 0.375rem 0.5rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.category-hint {
		border-top: 1px solid var(--color-line);
		line-height: 1.4;
	}

	.category-error {
		color: var(--color-danger);
	}

	.category-option {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		text-align: left;
		color: var(--color-text);
	}

	.category-option:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.category-check {
		display: inline-flex;
		width: 1rem;
		color: var(--color-accent-text);
	}
</style>
