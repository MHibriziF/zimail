<script lang="ts">
	import { t } from '$lib/i18n';
	import { placeAtPoint, placeMenu, rowMenu, selectionMenu, type MenuSections, type RowAction } from '$lib/mail/row-actions';
	import { DANGER_ACTIONS, rowActionLabel, rowMenuLabel, senderOf } from '$lib/mail/row-action-labels';
	import RowMenuPopover from '$lib/components/mailbox/RowMenuPopover.svelte';
	import type { MailboxView, ThreadSummary } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
	import type { ZeroIconName } from '../icons/names';

	let {
		view,
		onAction,
		openFor = $bindable(null)
	}: {
		view: MailboxView;
		/** One conversation, or every conversation in the selection the menu was opened on. */
		onAction: (action: RowAction, threads: ThreadSummary[]) => void;
		/** The conversation whose menu is open, so its row can keep its button showing. */
		openFor?: string | null;
	} = $props();

	let popover = $state<ReturnType<typeof RowMenuPopover> | null>(null);
	let targets = $state<ThreadSummary[]>([]);

	const sections = $derived.by<MenuSections>(() => {
		if (targets.length > 1) return selectionMenu(view, targets);
		const [only] = targets;
		return only ? rowMenu(view, only, senderOf(only) !== null) : [];
	});

	const ICONS: Record<RowAction, ZeroIconName> = {
		open: 'OpenMail',
		openTab: 'ArrowsPointingOut',
		editDraft: 'Pencil',
		reply: 'Reply',
		replyAll: 'ReplyAll',
		forward: 'Forward',
		star: 'Star2',
		unstar: 'Star2',
		label: 'Tag',
		archive: 'Archive2',
		unarchive: 'Inbox',
		read: 'OpenMail',
		unread: 'Mail',
		copySender: 'User',
		withSender: 'Search',
		spam: 'ExclamationTriangle',
		notspam: 'CircleCheck',
		trash: 'Trash',
		restore: 'CurvedArrow',
		delete: 'Trash'
	};

	const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

	function setTargets(next: ThreadSummary[]) {
		targets = next;
		openFor = next[0]?.thread_id ?? null;
	}

	/** Opens for `next` under the button pressed, or closes when that button's menu is already open. */
	export async function toggle(next: ThreadSummary, from: HTMLElement) {
		if (targets.length === 1 && targets[0].thread_id === next.thread_id) {
			popover?.close();
			return;
		}
		setTargets([next]);
		await popover?.show(from, (size) => placeMenu(from.getBoundingClientRect(), size, viewport()));
	}

	/**
	 * Opens at the pointer, like a desktop context menu. A right-click from the
	 * keyboard (the menu key, Shift+F10) has no pointer, so it opens under `from`.
	 */
	export async function openAt(next: ThreadSummary[], from: HTMLElement, point: { x: number; y: number } | null) {
		setTargets(next);
		await popover?.show(
			from,
			(size) => (point ? placeAtPoint(point, size, viewport()) : placeMenu(from.getBoundingClientRect(), size, viewport())),
			point !== null
		);
	}

	function choose(action: RowAction) {
		const chosen = targets;
		popover?.close(action !== 'openTab');
		if (chosen.length > 0) onAction(action, chosen);
	}
</script>

<RowMenuPopover bind:this={popover} class="z-row-menu" label={rowMenuLabel(targets)} onclose={() => setTargets([])}>
	{#if targets.length > 1}
		<div class="z-row-menu-caption" role="none">{t('mailbox.selectionCount', { count: targets.length })}</div>
	{/if}
	{#each sections as section, index (section.join())}
		{#if index > 0}
			<div class="z-row-menu-divider" role="separator"></div>
		{/if}
		{#each section as action (action)}
			<button type="button" role="menuitem" tabindex="-1" class:danger={DANGER_ACTIONS.has(action)} onclick={() => choose(action)}>
				<Icon name={ICONS[action]} size={16} class={action === 'unstar' ? 'z-star-on' : ''} />
				<span class="z-row-menu-label">{rowActionLabel(action, targets[0])}</span>
			</button>
		{/each}
	{/each}
</RowMenuPopover>
