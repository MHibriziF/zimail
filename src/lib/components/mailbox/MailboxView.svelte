<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page as currentPage } from '$app/stores';
	import Icon from '../Icon.svelte';
	import EmptyState from './EmptyState.svelte';
	import PullToRefresh from './PullToRefresh.svelte';
	import MailboxRow from './MailboxRow.svelte';
	import MailboxSelectAll from './MailboxSelectAll.svelte';
	import MailboxMoreMenu from './MailboxMoreMenu.svelte';
	import MailboxFilterMenu from './MailboxFilterMenu.svelte';
	import { patchThread, runMailAction } from '$lib/mail/client';
	import { t } from '$lib/i18n';
	import { haptic, isPrimaryTab } from '$lib/app-chrome';
	import type { MailAddress, MailboxFilters, MailboxPage, MailboxView, ThreadSummary } from '$lib/types';

	let {
		view,
		mailbox,
		filters
	}: {
		view: MailboxView;
		mailbox: MailboxPage;
		filters: MailboxFilters;
	} = $props();

	const META = $derived(
		({
			inbox: { title: t('nav.inbox'), icon: 'inbox-line', empty: t('mailbox.empty.inbox') },
			archive: { title: t('nav.archive'), icon: 'archive-line', empty: t('mailbox.empty.archive') },
			starred: { title: t('nav.starred'), icon: 'star-line', empty: t('mailbox.empty.starred') },
			drafts: { title: t('nav.drafts'), icon: 'draft-line', empty: t('mailbox.empty.drafts') },
			sent: { title: t('nav.sent'), icon: 'send-plane-line', empty: t('mailbox.empty.sent') },
			trash: { title: t('nav.trash'), icon: 'delete-bin-line', empty: t('mailbox.empty.trash') }
		}) satisfies Record<MailboxView, { title: string; icon: string; empty: string }>
	);

	const meta = $derived(META[view]);
	const addresses = $derived(($currentPage.data.addresses ?? []) as MailAddress[]);

	// Local copy so stars and reads can flip before the server round trip lands.
	// Seeded from the prop so the server renders the rows; see Zero's Mailbox.
	let items = $state<ThreadSummary[]>(mailbox.threads);
	let selected = $state<string[]>([]);
	let busy = $state(false);
	let selecting = $state(false);
	let hadSelection = $state(false);
	let longPressTimer = 0;
	let longPressFired = false;
	let pressX = 0;
	let pressY = 0;

	$effect(() => {
		const next = mailbox.threads;
		items = next;
		const ids = new Set(next.map((thread) => thread.thread_id));
		selected = untrack(() => selected).filter((id) => ids.has(id));
	});

	$effect(() => {
		if (selected.length > 0) hadSelection = true;
		if (hadSelection && selected.length === 0) {
			selecting = false;
			hadSelection = false;
		}
	});

	const hideMailboxTitle = $derived(isPrimaryTab(`/${view}`));

	const allSelected = $derived(items.length > 0 && selected.length === items.length);
	const someSelected = $derived(selected.length > 0);
	const activeFilterCount = $derived(
		[filters.unreadOnly, filters.starredOnly, filters.attachmentsOnly, filters.addressId].filter(
			Boolean
		).length
	);

	function toggle(id: string) {
		selected = selected.includes(id)
			? selected.filter((value) => value !== id)
			: [...selected, id];
	}

	/** One entry point for every list action, so the UI always refreshes after. */
	async function run(action: string, ids: string[] = selected) {
		if (busy) return;
		busy = true;
		try {
			await runMailAction(action, ids);
			selected = [];
			await invalidateAll();
		} finally {
			busy = false;
		}
	}

	function beginLongPress(thread: ThreadSummary, event: PointerEvent) {
		longPressFired = false;
		pressX = event.clientX;
		pressY = event.clientY;
		window.clearTimeout(longPressTimer);
		longPressTimer = window.setTimeout(() => {
			longPressFired = true;
			selecting = true;
			if (!selected.includes(thread.latest_id)) toggle(thread.latest_id);
			haptic(16);
		}, 420);
	}

	function cancelLongPress() {
		window.clearTimeout(longPressTimer);
	}

	function moveLongPress(event: PointerEvent) {
		if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 8) cancelLongPress();
	}

	function onRowLinkClick(thread: ThreadSummary, event: MouseEvent) {
		if (longPressFired || selecting) {
			event.preventDefault();
			if (selecting) toggle(thread.latest_id);
		}
	}

	async function toggleStar(thread: ThreadSummary) {
		const isStarred = !thread.is_starred;
		items = items.map((row) =>
			row.thread_id === thread.thread_id ? { ...row, is_starred: isStarred } : row
		);

		await patchThread(thread.latest_id, { isStarred });
		await invalidateAll();
	}

	/** Builds a URL for this mailbox with some query params changed. */
	function withParams(changes: Record<string, string | number | boolean | null>): string {
		const params = new URLSearchParams($currentPage.url.searchParams);

		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === false || value === '') params.delete(key);
			else params.set(key, String(value));
		}

		// Changing what is listed invalidates the current page number.
		if (!('page' in changes)) params.delete('page');

		const query = params.toString();
		return `${$currentPage.url.pathname}${query ? `?${query}` : ''}`;
	}

	const rangeStart = $derived(
		mailbox.total === 0 ? 0 : (mailbox.page - 1) * mailbox.pageSize + 1
	);
	const rangeEnd = $derived(Math.min(mailbox.page * mailbox.pageSize, mailbox.total));
</script>

<PullToRefresh onRefresh={invalidateAll}>
<section class="mailbox" data-view={view} class:selecting class:primary-tab={hideMailboxTitle}>
	<header class="toolbar">
		<div class="toolbar-left">
			<MailboxSelectAll
				{items}
				checked={allSelected}
				indeterminate={someSelected && !allSelected}
				bind:selected
			/>

			{#if someSelected}
				<span class="selected-count">{t('mailbox.selectedCount', { count: selected.length })}</span>

				<div class="bulk-actions">
					<button type="button" class="tool-btn" title={t('mailbox.markRead')} disabled={busy} onclick={() => run('read')}>
						<Icon name="mail-open-line" size={16} />
					</button>
					<button type="button" class="tool-btn" title={t('mailbox.markUnread')} disabled={busy} onclick={() => run('unread')}>
						<Icon name="mail-line" size={16} />
					</button>
					<button type="button" class="tool-btn" title={t('mailbox.star')} disabled={busy} onclick={() => run('star')}>
						<Icon name="star-line" size={16} />
					</button>
					<button type="button" class="tool-btn" title={t('mailbox.removeStar')} disabled={busy} onclick={() => run('unstar')}>
						<Icon name="star-off-line" size={16} />
					</button>

					{#if view === 'archive'}
						<button type="button" class="tool-btn" title={t('mailbox.moveToInbox')} disabled={busy} onclick={() => run('unarchive')}>
							<Icon name="inbox-line" size={16} />
						</button>
					{:else if view !== 'drafts' && view !== 'trash'}
						<button type="button" class="tool-btn" title={t('nav.archive')} disabled={busy} onclick={() => run('archive')}>
							<Icon name="archive-line" size={16} />
						</button>
					{/if}

					{#if view === 'trash'}
						<button type="button" class="tool-btn" title={t('mailbox.restore')} disabled={busy} onclick={() => run('restore')}>
							<Icon name="arrow-go-back-line" size={16} />
						</button>
						<button type="button" class="tool-btn danger" title={t('mailbox.deletePermanently')} disabled={busy} onclick={() => run('delete')}>
							<Icon name="delete-bin-2-line" size={16} />
						</button>
					{:else}
						<button type="button" class="tool-btn" title={t('mailbox.moveToTrash')} disabled={busy} onclick={() => run('trash')}>
							<Icon name="delete-bin-line" size={16} />
						</button>
					{/if}
				</div>
			{:else}
				<h1 class="title">{meta.title}</h1>
				{#if mailbox.total > 0}
					<span class="total">{mailbox.total}</span>
				{/if}

				<MailboxMoreMenu
					{view}
					{filters}
					{addresses}
					{activeFilterCount}
					hasQuery={Boolean(filters.q)}
					{selecting}
					onStartSelecting={() => (selecting = true)}
					onCancelSelection={() => {
						selected = [];
						selecting = false;
						hadSelection = false;
					}}
					onRun={run}
					{withParams}
				/>
			{/if}
		</div>

		<div class="toolbar-right">
			<button
				type="button"
				class="pill unread-pill"
				class:pill-on={filters.unreadOnly}
				onclick={() => goto(withParams({ unread: filters.unreadOnly ? null : '1' }))}
			>
				Unread
			</button>

			<MailboxFilterMenu {filters} {addresses} {activeFilterCount} hasQuery={Boolean(filters.q)} {withParams} />

			<div class="pager" class:pager-single={mailbox.pageCount <= 1}>
				<a
					class="pager-btn"
					class:disabled={mailbox.page <= 1}
					href={withParams({ page: mailbox.page - 1 })}
					aria-label={t('mailbox.previousPage')}
				>
					<Icon name="arrow-left-s-line" size={16} />
				</a>
				<span class="pager-label">{mailbox.page}/{mailbox.pageCount}</span>
				<a
					class="pager-btn"
					class:disabled={mailbox.page >= mailbox.pageCount}
					href={withParams({ page: mailbox.page + 1 })}
					aria-label={t('mailbox.nextPage')}
				>
					<Icon name="arrow-right-s-line" size={16} />
				</a>
			</div>
		</div>
	</header>

	{#if activeFilterCount > 0}
		<div class="filter-chips" aria-label={t('mailbox.activeFilters')}>
			{#if filters.unreadOnly}
				<a href={withParams({ unread: null })} class="filter-chip">{t('mailbox.unread')}</a>
			{/if}
			{#if filters.starredOnly}
				<a href={withParams({ starred: null })} class="filter-chip">{t('nav.starred')}</a>
			{/if}
			{#if filters.attachmentsOnly}
				<a href={withParams({ attachments: null })} class="filter-chip">{t('mailbox.attachments')}</a>
			{/if}
			{#if filters.addressId}
				{@const filtered = addresses.find((address) => address.id === filters.addressId)}
				<a href={withParams({ address: null })} class="filter-chip">
					{filtered?.label || filtered?.address || t('mailbox.address')}
				</a>
			{/if}
		</div>
	{/if}

	{#if filters.q}
		<div class="search-note">
			<Icon name="search-line" size={14} />
			<span>
				{t(mailbox.total === 1 ? 'mailbox.searchResults' : 'mailbox.searchResultsPlural', {
					count: mailbox.total,
					query: filters.q
				})}
			</span>
			<a href={withParams({ q: null })} class="search-clear">{t('mailbox.clear')}</a>
		</div>
	{/if}

	<div class="list">
		{#if items.length === 0}
			<EmptyState
				icon={filters.q ? 'search-line' : meta.icon}
				title={filters.q ? t('mailbox.empty.search') : meta.empty}
			/>
		{:else}
			<ul>
				{#each items as thread (thread.thread_id)}
					<MailboxRow
						{thread}
						{view}
						{addresses}
						selected={selected.includes(thread.latest_id)}
						{selecting}
						onToggle={() => toggle(thread.latest_id)}
						onToggleStar={() => toggleStar(thread)}
						onRun={(action) => run(action, [thread.latest_id])}
						onLinkClick={(event) => onRowLinkClick(thread, event)}
						onPointerDown={(event) => beginLongPress(thread, event)}
						onPointerUp={cancelLongPress}
						onPointerCancel={cancelLongPress}
						onPointerMove={moveLongPress}
					/>
				{/each}
			</ul>
		{/if}
	</div>

	{#if mailbox.total > 0}
		<footer class="list-foot">
			<span>{t('mailbox.rangeOf', { start: rangeStart, end: rangeEnd, total: mailbox.total })}</span>
		</footer>
	{/if}
</section>
</PullToRefresh>

<style>
	.mailbox {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border-radius: 1rem;
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.filter-chips {
		display: none;
	}

	/* --- toolbar --- */

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.875rem;
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.toolbar-left,
	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.title {
		font-size: 1.0625rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.total {
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.selected-count {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.bulk-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		margin-left: 0.25rem;
	}

	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.875rem;
		height: 1.875rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.tool-btn:disabled {
		opacity: 0.4;
	}

	.tool-btn.danger:hover {
		color: var(--color-danger);
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		height: 1.875rem;
		padding: 0 0.6875rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: background 0.15s, color 0.15s, box-shadow 0.15s;
	}

	.pill:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.pill-on {
		color: var(--color-text);
		font-weight: 500;
		background: var(--color-surface-hover);
		box-shadow: inset 0 0 0 1px transparent;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.pager-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		transition: background 0.15s;
	}

	.pager-btn:hover {
		background: var(--color-surface-muted);
	}

	.pager-btn.disabled {
		pointer-events: none;
		color: var(--color-muted);
		opacity: 0.4;
	}

	.pager-label {
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	/* --- search note --- */

	.search-note {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.search-clear {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-muted);
		text-decoration: underline;
	}

	.search-clear:hover {
		color: var(--color-text);
	}

	.list-foot {
		display: flex;
		justify-content: flex-end;
		padding: 0.625rem 0.875rem;
		font-size: 0.75rem;
		color: var(--color-muted);
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	@media (max-width: 900px) {
		.mailbox {
			flex: 1;
			border-radius: 0;
			box-shadow: none;
			min-height: 100%;
			background: var(--color-bg);
		}

		.toolbar {
			position: sticky;
			top: 0;
			z-index: 8;
			flex-wrap: wrap;
			padding: 0.5rem 0.75rem;
			background: var(--color-surface);
		}

		.mailbox:not(.selecting) .toolbar-right {
			display: none;
		}

		.mailbox.primary-tab:not(.selecting) .toolbar {
			justify-content: flex-end;
			padding: 0.25rem 0.5rem;
			background: var(--color-bg);
			box-shadow: none;
		}

		.mailbox.primary-tab:not(.selecting) .toolbar-left {
			margin-left: auto;
		}

		.mailbox.primary-tab:not(.selecting) .title,
		.mailbox.primary-tab:not(.selecting) .total {
			display: none;
		}

		.filter-chips {
			display: flex;
			flex-wrap: wrap;
			gap: 0.5rem;
			padding: 0.5rem 1rem;
		}

		.filter-chip {
			display: inline-flex;
			align-items: center;
			min-height: 2rem;
			padding: 0 0.75rem;
			border-radius: 9999px;
			font-size: 0.8125rem;
			font-weight: 500;
			color: var(--color-accent-text);
			background: var(--color-accent-soft);
		}

		.unread-pill {
			display: none;
		}

		.mailbox:not(.selecting) :global(.select-all) {
			display: none;
		}

		.tool-btn,
		.pager-btn {
			width: var(--touch-target);
			height: var(--touch-target);
		}

		.pill {
			height: 2.25rem;
			padding: 0 0.875rem;
		}

		.mailbox:not(.selecting) :global(.row .swipe-content) {
			grid-template-columns: minmax(0, 1fr);
		}

		.mailbox:not(.selecting) :global(.row .check) {
			display: none;
		}

		.title {
			font-size: 1.0625rem;
		}

		.list-foot {
			display: none;
		}

		.pager-single {
			display: none;
		}
	}
</style>
