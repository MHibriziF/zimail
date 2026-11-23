<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { formatRelativeDate } from '$lib/utils/date';
	import { runMailAction } from '$lib/mail/client';
	import { markThreadReadInSnapshots } from '$lib/mail/mailbox-cache';
	import { folderTitle, initials, participantName } from '$lib/mail/folders';
	import { t } from '$lib/i18n';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import ResizeHandle from '$lib/components/ResizeHandle.svelte';
	import LabelChip from '$lib/components/mailbox/LabelChip.svelte';
	import LabelPicker from '$lib/components/mailbox/LabelPicker.svelte';
	import type { Label } from '$lib/mail/labels';
	import InboxTabs from '$lib/components/mailbox/InboxTabs.svelte';
	import type { MailboxFilters, MailboxPage, MailboxView, ThreadSummary } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
	import ThreadPane from './ThreadPane.svelte';
	import RowActionsMenu from './RowActionsMenu.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { closeThreadGoesBack, openThreadNavigation } from '$lib/mail/thread-history';
	import type { RowAction } from '$lib/mail/row-actions';

	let {
		view,
		mailbox,
		filters
	}: {
		view: MailboxView;
		mailbox: MailboxPage;
		filters: MailboxFilters;
	} = $props();

	let selected = $state<string[]>([]);
	let deleting = $state<string | null>(null);
	// Seeded from the prop, not left empty for an effect to fill: effects do not
	// run during SSR, so an empty start renders the "nothing here" state on the
	// server and the rows only appear once hydration catches up.
	let items = $state<ThreadSummary[]>(mailbox.threads);
	let refreshing = $state(false);
	let isMac = $state(true);
	/** The server can't tell the platform, so the shortcut hint waits rather than flipping from ⌘ to Ctrl. */
	let platformKnown = $state(false);

	$effect(() => {
		const next = mailbox.threads;
		items = next;
		const ids = new Set(next.map((thread) => thread.thread_id));
		selected = untrack(() => selected).filter((id) => ids.has(id));
	});

	$effect(() => {
		isMac = /Mac|iPhone|iPad/.test(navigator.platform);
		platformKnown = true;
	});

	const threadId = $derived($page.url.searchParams.get('thread'));
	const chip = $derived(
		filters.unreadOnly ? 'unread' : filters.starredOnly ? 'starred' : 'all'
	);
	let dark = $state(false);

	$effect(() => {
		dark = document.documentElement.dataset.theme === 'dark';
	});

	function threadHref(id: string | null): string {
		const url = new URL($page.url);
		if (id) url.searchParams.set('thread', id);
		else url.searchParams.delete('thread');
		return `${url.pathname}?${url.searchParams.toString()}`.replace(/\?$/, '');
	}

	let rows = $state<HTMLDivElement | null>(null);
	let actionsMenu = $state<ReturnType<typeof RowActionsMenu> | null>(null);
	let menuFor = $state<string | null>(null);
	/** The ⋯ button the actions menu opened from, so Label can open in the same spot. */
	let menuAnchor: HTMLElement | null = null;
	let labelling = $state<{ thread: ThreadSummary; anchor: DOMRect } | null>(null);
	let labelOpen = $state(false);
	/** A row shows two labels and a count of the rest, so the subject keeps most of the line. */
	const ROW_LABELS = 2;
	let listEl = $state<HTMLElement>();
	/** Kept while the list is shown, because a phone hides the list to read and that resets its scroll. */
	let listScroll = 0;
	/** The row a conversation was opened from, to land on again when it closes. */
	let returnTo: { id: string; index: number } | null = null;

	/** The row itself, or, when it has left this list (read under Unread, archived), the one that took its place. */
	function focusRow(id: string, index: number) {
		const openers = rows?.querySelectorAll<HTMLElement>('.z-row-open') ?? [];
		const own = rows?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"] .z-row-open`);
		(own ?? openers[index] ?? openers[openers.length - 1])?.focus({ preventScroll: true });
	}

	function setThread(id: string | null) {
		if (id) {
			const index = items.findIndex((thread) => thread.latest_id === id);
			if (!threadId && index >= 0) returnTo = { id: items[index].thread_id, index };
			void goto(threadHref(id), { keepFocus: true, noScroll: true, ...openThreadNavigation(threadId, $page.state) });
		} else if (closeThreadGoesBack($page.state)) {
			history.back();
		} else {
			void goto(threadHref(null), { keepFocus: true, noScroll: true, replaceState: true });
		}
	}

	// Back on the list, however it got there (the close button, Escape, the back gesture): where it was, on the row read.
	$effect(() => {
		if (threadId) return;
		const from = untrack(() => returnTo);
		returnTo = null;
		if (!from) return;
		void tick().then(() => {
			if (rows) rows.scrollTop = listScroll;
			focusRow(from.id, from.index);
		});
	});

	/** After an action takes a row out of this list, focus moves on to the row that took its place. */
	async function onRowAction(action: RowAction, thread: ThreadSummary) {
		if (action === 'label') {
			const anchor = menuAnchor?.isConnected ? menuAnchor.getBoundingClientRect() : null;
			if (!anchor) return;
			labelling = { thread, anchor };
			labelOpen = true;
			return;
		}
		if (action === 'delete') {
			deleting = thread.latest_id;
			return;
		}
		const index = items.findIndex((item) => item.thread_id === thread.thread_id);
		await act(action, [thread.latest_id]);
		await tick();
		if (document.activeElement && document.activeElement !== document.body) return;
		focusRow(thread.thread_id, index);
	}

	function markThreadRead(threadId: string) {
		items = filters.unreadOnly
			? items.filter((thread) => thread.thread_id !== threadId)
			: items.map((thread) =>
					thread.thread_id === threadId ? { ...thread, is_read: true } : thread
				);
		markThreadReadInSnapshots(threadId);
		void invalidateAll();
	}

	function setChip(next: 'all' | 'unread' | 'starred') {
		const url = new URL($page.url);
		url.searchParams.delete('unread');
		url.searchParams.delete('starred');
		if (next === 'unread') url.searchParams.set('unread', '1');
		if (next === 'starred') url.searchParams.set('starred', '1');
		void goto(`${url.pathname}?${url.searchParams.toString()}`.replace(/\?$/, ''));
	}

	function openPalette() {
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'k',
				metaKey: isMac,
				ctrlKey: !isMac,
				bubbles: true
			})
		);
	}

	function toggleSidebar() {
		window.dispatchEvent(new Event('zero:toggle-sidebar'));
	}

	function openCompose() {
		window.dispatchEvent(new Event('zero:compose'));
	}

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			window.setTimeout(() => {
				refreshing = false;
			}, 280);
		}
	}

	async function act(action: string, ids: string[]) {
		await runMailAction(action, ids);
		await invalidateAll();
	}

	function draftHref(thread: ThreadSummary): string {
		const url = new URL($page.url);
		url.searchParams.set('compose', '1');
		url.searchParams.set('draft', thread.latest_id);
		return `${url.pathname}?${url.searchParams.toString()}`;
	}

	function onRowClick(thread: ThreadSummary, event: MouseEvent) {
		event.preventDefault();
		if (event.metaKey || event.ctrlKey || event.shiftKey) {
			selected = selected.includes(thread.thread_id)
				? selected.filter((id) => id !== thread.thread_id)
				: [...selected, thread.thread_id];
			return;
		}
		if (thread.is_draft) {
			void goto(draftHref(thread));
			return;
		}
		setThread(thread.latest_id);
	}

	function onListKey(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			return;
		}
		const current = threadId ? items.find((thread) => thread.latest_id === threadId) : null;
		const ids = selected.length
			? (selected
					.map((id) => items.find((thread) => thread.thread_id === id)?.latest_id)
					.filter(Boolean) as string[])
			: current
				? [current.latest_id]
				: [];
		if (ids.length === 0) return;

		if (event.key === 'e') {
			event.preventDefault();
			void act(view === 'archive' ? 'unarchive' : 'archive', ids);
		} else if (event.key === 'd' || event.key === 'Backspace') {
			event.preventDefault();
			void act(view === 'trash' ? 'restore' : 'trash', ids);
		} else if (event.key === 's') {
			event.preventDefault();
			void act(current?.is_starred ? 'unstar' : 'star', ids);
		} else if (event.key === 'r' && !threadId) {
			event.preventDefault();
			void act('read', ids);
		} else if (event.key === 'u') {
			event.preventDefault();
			void act('unread', ids);
		} else if (event.key === '1') {
			setChip('all');
		} else if (event.key === '2') {
			setChip('unread');
		} else if (event.key === '3') {
			setChip('starred');
		} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			selected = items.map((thread) => thread.thread_id);
		} else if (event.key === 'Escape') {
			selected = [];
			setThread(null);
		}
	}
</script>

<svelte:window onkeydown={onListKey} />

<div class="z-mail" class:reading={Boolean(threadId)}>
	<section class="z-panel z-list" bind:this={listEl}>
		<div class="z-list-head">
			<div class="z-list-tools">
				<Tooltip text={t('nav.toggleSidebar')}>
					<button type="button" class="z-icon-btn" aria-label={t('nav.toggleSidebar')} onclick={toggleSidebar}>
						<Icon name="PanelLeftOpen" size={16} />
					</button>
				</Tooltip>
				<h1 class="z-list-title">{folderTitle(view, $page.data.locale)}</h1>
				<Tooltip text={t('common.search')} shortcut={isMac ? '⌘K' : 'Ctrl+K'} grow>
					<button type="button" class="z-search" onclick={openPalette}>
						<Icon name="Search" size={16} />
						<span class="z-search-label">{t('common.search')}</span>
						{#if platformKnown}
							<kbd>
								<span>{isMac ? '⌘' : 'Ctrl'}</span>
								<span>K</span>
							</kbd>
						{/if}
					</button>
				</Tooltip>
				<Tooltip text={t('common.refresh')}>
					<button
						type="button"
						class="z-icon-btn"
						class:spin={refreshing}
						aria-label={t('common.refresh')}
						onclick={refresh}
					>
						<Icon name="ArrowCircle" size={16} />
					</button>
				</Tooltip>
			</div>
			<div class="z-load-bar" class:on={refreshing}></div>
		</div>

		<div class="z-chips">
			<button type="button" class="z-chip" class:active={chip === 'all'} aria-pressed={chip === 'all'} data-chip="all" onclick={() => setChip('all')}>
				{t('mailbox.allMailChip')}
			</button>
			<button
				type="button"
				class="z-chip"
				class:active={chip === 'unread'} aria-pressed={chip === 'unread'}
				data-chip="unread"
				onclick={() => setChip('unread')}
			>
				{t('mailbox.unread')}
			</button>
			<button
				type="button"
				class="z-chip"
				class:active={chip === 'starred'} aria-pressed={chip === 'starred'}
				data-chip="starred"
				onclick={() => setChip('starred')}
			>
				{t('nav.starred')}
			</button>
		</div>

		{#if filters.tab}
			<div class="z-tabs">
				<InboxTabs active={filters.tab} />
			</div>
		{/if}

		<div class="z-rows" bind:this={rows} onscroll={() => (listScroll = rows?.scrollTop ?? 0)}>
			{#if items.length === 0}
				<div class="z-empty">
					<img
						src={dark ? '/themes/zero/empty-state.svg' : '/themes/zero/empty-state-light.svg'}
						alt=""
					/>
					<p class="z-empty-title">{t('mailbox.empty.zero')}</p>
					<p class="z-empty-copy">
						{t('mailbox.empty.zeroHint')}
						<button type="button" class="z-empty-link" onclick={() => setChip('all')}>{t('mailbox.empty.clearFiltersLink')}</button>
					</p>
				</div>
			{:else}
				{#each items as thread (thread.thread_id)}
					{@const name = participantName(thread.participants, view, $page.data.locale)}
					<div
						class="z-row"
						data-thread-id={thread.thread_id}
						class:selected={thread.latest_id === threadId || selected.includes(thread.thread_id)}
						class:unread={!thread.is_read}
						class:read={thread.is_read}
						class:menu-open={menuFor === thread.thread_id}
					>
						<a
							class="z-row-open"
							href={thread.is_draft ? draftHref(thread) : threadHref(thread.latest_id)}
							aria-current={thread.latest_id === threadId ? 'true' : undefined}
							onclick={(event) => onRowClick(thread, event)}
						>
							<span class="z-avatar">{initials(name)}</span>
							<span class="z-row-main">
								<span class="z-row-top">
									<span class="z-row-name">
										{name}
										{#if !thread.is_read && view !== 'sent'}
											<span class="z-unread-dot"></span>
											<span class="z-sr-only">{t('mailbox.unread')}</span>
										{/if}
										{#if thread.message_count > 1}
											<span class="z-row-count">[{thread.message_count}]</span>
										{/if}
										{#if thread.is_draft}
											<Icon name="PencilCompose" size={12} />
										{/if}
									</span>
									<span class="z-row-date">{formatRelativeDate(thread.created_at, $page.data.locale, $page.data.timeZone ?? undefined)}</span>
								</span>
								<span class="z-row-subject">
									<span class="z-row-subject-text">{thread.subject || t('mailbox.noSubject')}</span>
									{#if thread.labels.length > 0 || thread.has_attachments}
										<span class="z-row-tags">
											{#each thread.labels.slice(0, ROW_LABELS) as label, index (label.id)}
												<span class="z-row-tag" class:extra={index > 0}><LabelChip {label} /></span>
											{/each}
											<!-- Two counts, for the two widths a row can show: two labels, or one when narrow. -->
											{#if thread.labels.length > ROW_LABELS}
												<span class="z-row-tags-more wide" title={thread.labels.slice(ROW_LABELS).map((label) => label.name).join(', ')}
													>+{thread.labels.length - ROW_LABELS}</span
												>
											{/if}
											{#if thread.labels.length > 1}
												<span class="z-row-tags-more narrow" title={thread.labels.slice(1).map((label) => label.name).join(', ')}
													>+{thread.labels.length - 1}</span
												>
											{/if}
											{#if thread.has_attachments}
												<Icon name="Paper" size={12} />
											{/if}
										</span>
									{/if}
								</span>
								{#if thread.preview}
									<span class="z-row-preview">{thread.preview}</span>
								{/if}
							</span>
						</a>
						<div class="z-row-hover">
							<!-- For a mouse only: keyboard and touch get the same actions, and more, from the menu. -->
							<span class="z-row-quick">
								<Tooltip text={thread.is_starred ? t('mailbox.unstar') : t('mailbox.star')}>
									<button
										type="button"
										tabindex="-1"
										aria-label={thread.is_starred ? t('mailbox.unstar') : t('mailbox.star')}
										onclick={() => void act(thread.is_starred ? 'unstar' : 'star', [thread.latest_id])}
									>
										<Icon name="Star2" class={thread.is_starred ? 'z-star-on' : ''} size={14} />
									</button>
								</Tooltip>
								<Tooltip text={view === 'archive' ? t('mailbox.moveToInbox') : t('nav.archive')}>
									<button
										type="button"
										tabindex="-1"
										aria-label={view === 'archive' ? t('mailbox.moveToInbox') : t('nav.archive')}
										onclick={() => void act(view === 'archive' ? 'unarchive' : 'archive', [thread.latest_id])}
									>
										<Icon name="Archive2" size={14} />
									</button>
								</Tooltip>
								{#if view === 'trash'}
									<Tooltip text={t('mailbox.restore')}>
										<button
											type="button"
											tabindex="-1"
											aria-label={t('mailbox.restore')}
											onclick={() => void act('restore', [thread.latest_id])}
										>
											<Icon name="CurvedArrow" size={14} />
										</button>
									</Tooltip>
									<Tooltip text={t('mailbox.deletePermanently')}>
										<button
											type="button"
											class="danger"
											tabindex="-1"
											aria-label={t('mailbox.deletePermanently')}
											onclick={() => (deleting = thread.latest_id)}
										>
											<Icon name="Trash" size={14} />
										</button>
									</Tooltip>
								{:else}
									<Tooltip text={t('nav.bin')}>
										<button
											type="button"
											class="danger"
											tabindex="-1"
											aria-label={t('nav.bin')}
											onclick={() => void act('trash', [thread.latest_id])}
										>
											<Icon name="Trash" size={14} />
										</button>
									</Tooltip>
								{/if}
							</span>
							<button
								type="button"
								class="z-row-more"
								aria-haspopup="menu"
								aria-expanded={menuFor === thread.thread_id}
								aria-label={t('mailbox.actionsFor', { subject: thread.subject || t('mailbox.noSubject') })}
								onclick={(event) => {
									menuAnchor = event.currentTarget;
									actionsMenu?.toggle(thread, event.currentTarget);
								}}
							>
								<Icon name="ThreeDots" size={14} />
							</button>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>
	<ResizeHandle pane="listPx" target={() => listEl} label={t('mailbox.resizeList')} class="z-resize-list" />

	<section class="z-panel z-read">
		<ThreadPane
			id={threadId}
			view={view}
			onClose={() => setThread(null)}
			onCompose={openCompose}
			onRead={markThreadRead}
		/>
	</section>
</div>

<RowActionsMenu bind:this={actionsMenu} bind:openFor={menuFor} {view} onAction={onRowAction} />

{#if labelling}
	<LabelPicker
		emailId={labelling.thread.latest_id}
		labels={($page.data.labels ?? []) as Label[]}
		applied={labelling.thread.labels}
		trigger={false}
		bind:open={labelOpen}
		anchor={labelling.anchor}
		onchange={(next) => {
			if (labelling) labelling = { ...labelling, thread: { ...labelling.thread, labels: next } };
			void invalidateAll();
		}}
	/>
{/if}

<ConfirmDialog
	open={deleting !== null}
	title={t('mailbox.deleteForeverTitle')}
	message={t('mailbox.deleteForeverOne')}
	confirmLabel={t('mailbox.deletePermanently')}
	onCancel={() => (deleting = null)}
	onConfirm={() => {
		if (deleting) void act('delete', [deleting]);
		deleting = null;
	}}
/>
