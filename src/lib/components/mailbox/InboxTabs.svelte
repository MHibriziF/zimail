<script lang="ts">
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import { MAIL_CATEGORIES, type MailCategory } from '$lib/mail/categories';

	let { active }: { active: MailCategory } = $props();

	const ICONS: Record<MailCategory, string> = {
		primary: 'inbox-line',
		social: 'group-line',
		promotions: 'price-tag-3-line',
		updates: 'information-line',
		forums: 'discuss-line'
	};

	const counts = $derived(($page.data.tabCounts ?? null) as Record<MailCategory, number> | null);

	/** Same inbox, other tab — page number and thread selection don't carry over. */
	function hrefFor(tab: MailCategory): string {
		const params = new URLSearchParams($page.url.searchParams);
		params.delete('page');
		params.delete('thread');
		if (tab === 'primary') params.delete('tab');
		else params.set('tab', tab);
		const query = params.toString();
		return `${$page.url.pathname}${query ? `?${query}` : ''}`;
	}
</script>

<nav class="inbox-tabs" aria-label={t('tabs.label')}>
	{#each MAIL_CATEGORIES as tab (tab)}
		<a class="inbox-tab" class:active={tab === active} href={hrefFor(tab)} aria-current={tab === active ? 'page' : undefined}>
			<Icon name={ICONS[tab]} size={15} />
			<span>{t(`tabs.${tab}`)}</span>
			{#if counts?.[tab]}
				<span class="inbox-tab-count">{counts[tab]}</span>
			{/if}
		</a>
	{/each}
</nav>

<style>
	.inbox-tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1px solid var(--color-line);
	}

	.inbox-tabs::-webkit-scrollbar {
		display: none;
	}

	.inbox-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
		padding: 0.5rem 0.75rem;
		margin-bottom: -1px;
		border-bottom: 2px solid transparent;
		font-size: 0.8125rem;
		white-space: nowrap;
		text-decoration: none;
		color: var(--color-text-secondary);
	}

	.inbox-tab:hover {
		color: var(--color-text);
	}

	.inbox-tab.active {
		border-bottom-color: var(--color-accent);
		font-weight: 500;
		color: var(--color-text);
	}

	.inbox-tab-count {
		padding: 0 0.375rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}
</style>
