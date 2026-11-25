<script lang="ts">
	import { t } from '$lib/i18n';
	import { placeAtPoint, placeMenu, rowMenu, selectionMenu, type MenuSections, type RowAction } from '$lib/mail/row-actions';
	import { DANGER_ACTIONS, rowActionLabel, rowMenuLabel, senderOf } from '$lib/mail/row-action-labels';
	import type { MailboxView, ThreadSummary } from '$lib/types';
	import Icon from '../Icon.svelte';
	import RowMenuPopover from './RowMenuPopover.svelte';

	let {
		view,
		onAction
	}: {
		view: MailboxView;
		/** One conversation, or every conversation in the selection the menu was opened on. */
		onAction: (action: RowAction, threads: ThreadSummary[]) => void;
	} = $props();

	let popover = $state<ReturnType<typeof RowMenuPopover> | null>(null);
	let targets = $state<ThreadSummary[]>([]);

	// Classic's reader has one Reply, which answers everyone, so there is no separate Reply all.
	const sections = $derived.by<MenuSections>(() => {
		const [only] = targets;
		let all: MenuSections = [];
		if (targets.length > 1) all = selectionMenu(view, targets);
		else if (only) all = rowMenu(view, only, senderOf(only) !== null);
		return all.map((section) => section.filter((action) => action !== 'replyAll'));
	});

	const ICONS: Record<RowAction, string> = {
		open: 'mail-open-line',
		openTab: 'external-link-line',
		editDraft: 'edit-line',
		reply: 'reply-line',
		replyAll: 'reply-all-line',
		forward: 'share-forward-line',
		star: 'star-line',
		unstar: 'star-off-line',
		label: 'price-tag-3-line',
		archive: 'archive-line',
		unarchive: 'inbox-line',
		read: 'mail-open-line',
		unread: 'mail-line',
		copySender: 'file-copy-line',
		withSender: 'search-line',
		spam: 'spam-2-line',
		notspam: 'inbox-unarchive-line',
		trash: 'delete-bin-line',
		restore: 'arrow-go-back-line',
		delete: 'delete-bin-2-line'
	};
	const WORDS = { trash: 'mailbox.moveToTrash', unstar: 'mailbox.removeStar' };

	/**
	 * Opens at the pointer, like a desktop context menu. A right-click from the
	 * keyboard (the menu key, Shift+F10) has no pointer, so it opens under `from`.
	 */
	export async function openAt(next: ThreadSummary[], from: HTMLElement, point: { x: number; y: number } | null) {
		targets = next;
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		await popover?.show(
			from,
			(size) => (point ? placeAtPoint(point, size, viewport) : placeMenu(from.getBoundingClientRect(), size, viewport)),
			point !== null
		);
	}

	function choose(action: RowAction) {
		const chosen = targets;
		popover?.close(action !== 'openTab');
		if (chosen.length > 0) onAction(action, chosen);
	}
</script>

<RowMenuPopover bind:this={popover} class="row-context-menu" label={rowMenuLabel(targets)} onclose={() => (targets = [])}>
	{#if targets.length > 1}
		<div class="caption" role="none">{t('mailbox.selectionCount', { count: targets.length })}</div>
	{/if}
	{#each sections as section, index (section.join())}
		{#if index > 0}
			<div class="divider" role="separator"></div>
		{/if}
		{#each section as action (action)}
			<button
				type="button"
				role="menuitem"
				tabindex="-1"
				class="item"
				class:danger={DANGER_ACTIONS.has(action)}
				onclick={() => choose(action)}
			>
				<Icon name={ICONS[action]} size={15} />
				<span class="item-label">{rowActionLabel(action, targets[0], WORDS)}</span>
			</button>
		{/each}
	{/each}
</RowMenuPopover>

<style>
	:global(.row-context-menu) {
		position: fixed;
		inset: auto;
		margin: 0;
		min-width: 12rem;
		max-width: min(18rem, calc(100vw - 1rem));
		padding: 0.25rem;
		border: none;
		background: var(--color-surface);
		color: var(--color-text);
		border-radius: calc(0.75rem * var(--radius-scale, 1));
		box-shadow: var(--shadow-md), 0 0 0 1px var(--color-line);
	}

	:global(.row-context-menu:focus-visible) {
		outline: none;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: calc(0.5rem * var(--radius-scale, 1));
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		text-align: left;
		transition: background 0.12s, color 0.12s;
	}

	.item:hover,
	.item:focus-visible {
		background: var(--color-surface-muted);
		color: var(--color-text);
		outline: none;
	}

	.item:focus-visible {
		box-shadow: inset 0 0 0 2px var(--color-focus-line);
	}

	.item.danger:hover,
	.item.danger:focus-visible {
		color: var(--color-danger);
	}

	.item-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.divider {
		height: 1px;
		margin: 0.25rem 0.375rem;
		background: var(--color-line);
	}

	.caption {
		padding: 0.375rem 0.625rem 0.25rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-muted);
	}
</style>
