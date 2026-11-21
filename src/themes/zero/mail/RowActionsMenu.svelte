<script lang="ts">
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { menuStep, placeMenu, rowActions, type RowAction } from '$lib/mail/row-actions';
	import type { MailboxView, ThreadSummary } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
	import type { ZeroIconName } from '../icons/names';

	let {
		view,
		onAction,
		openFor = $bindable(null)
	}: {
		view: MailboxView;
		onAction: (action: RowAction, thread: ThreadSummary) => void;
		/** The conversation whose menu is open, so its row can keep its button showing. */
		openFor?: string | null;
	} = $props();

	let menu = $state<HTMLDivElement | null>(null);
	let thread = $state<ThreadSummary | null>(null);
	let trigger: HTMLElement | null = null;
	const actions = $derived(thread ? rowActions(view, thread) : []);

	const LABELS: Record<RowAction, () => string> = {
		star: () => t('mailbox.star'),
		unstar: () => t('mailbox.unstar'),
		archive: () => t('nav.archive'),
		unarchive: () => t('mailbox.moveToInbox'),
		read: () => t('mailbox.markRead'),
		unread: () => t('mailbox.markUnread'),
		trash: () => t('nav.bin'),
		restore: () => t('mailbox.restore'),
		delete: () => t('mailbox.deletePermanently')
	};
	const ICONS: Record<RowAction, ZeroIconName> = {
		star: 'Star2',
		unstar: 'Star2',
		archive: 'Archive2',
		unarchive: 'Inbox',
		read: 'OpenMail',
		unread: 'Mail',
		trash: 'Trash',
		restore: 'CurvedArrow',
		delete: 'Trash'
	};

	/** Opens for `next` under the button pressed, or closes when that button's menu is already open. */
	export async function toggle(next: ThreadSummary, from: HTMLElement) {
		if (thread?.thread_id === next.thread_id) {
			close();
			return;
		}
		thread = next;
		openFor = next.thread_id;
		trigger = from;
		await tick();
		if (!menu) return;
		if (!menu.matches(':popover-open')) menu.showPopover();
		const { left, top } = placeMenu(
			from.getBoundingClientRect(),
			{ width: menu.offsetWidth, height: menu.offsetHeight },
			{ width: window.innerWidth, height: window.innerHeight }
		);
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
		items()[0]?.focus();
	}

	/** Closes and, unless focus has already moved somewhere on purpose, hands it back to the button. */
	function close(returnFocus = true) {
		const from = trigger;
		thread = null;
		openFor = null;
		trigger = null;
		if (menu?.matches(':popover-open')) menu.hidePopover();
		if (returnFocus && from?.isConnected) from.focus();
	}

	const items = () => Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

	function onKeydown(event: KeyboardEvent) {
		// The mailbox's own shortcuts (e, s, Escape…) must not act on the list behind the menu.
		event.stopPropagation();
		if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault();
			close();
			return;
		}
		const list = items();
		const next = menuStep(event.key, list.indexOf(document.activeElement as HTMLButtonElement), list.length);
		if (next === null) return;
		event.preventDefault();
		list[next].focus();
	}

	function onDocumentPointer(event: PointerEvent) {
		if (!thread) return;
		const target = event.target as Node;
		if (menu?.contains(target) || trigger?.contains(target)) return;
		close(false);
	}

	function choose(action: RowAction) {
		const chosen = thread;
		close();
		if (chosen) onAction(action, chosen);
	}
</script>

<svelte:document onpointerdown={onDocumentPointer} />
<svelte:window onresize={() => close(false)} />

<!-- Manual rather than auto: the row's own button toggles it, which light dismiss would turn into close-then-reopen. -->
<div
	bind:this={menu}
	class="z-row-menu"
	popover="manual"
	role="menu"
	tabindex="-1"
	aria-label={thread ? t('mailbox.actionsFor', { subject: thread.subject || t('mailbox.noSubject') }) : undefined}
	onkeydown={onKeydown}
>
	{#each actions as action (action)}
		<button
			type="button"
			role="menuitem"
			tabindex="-1"
			class:danger={action === 'trash' || action === 'delete'}
			onclick={() => choose(action)}
		>
			<Icon name={ICONS[action]} size={16} class={action === 'unstar' ? 'z-star-on' : ''} />
			{LABELS[action]()}
		</button>
	{/each}
</div>
