<script lang="ts">
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import {
		menuStep,
		placeAtPoint,
		placeMenu,
		rowMenu,
		selectionMenu,
		type MenuSections,
		type RowAction
	} from '$lib/mail/row-actions';
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

	let menu = $state<HTMLDivElement | null>(null);
	let targets = $state<ThreadSummary[]>([]);
	let trigger: HTMLElement | null = null;

	const sender = (thread: ThreadSummary) => thread.participants.find((person) => !person.self) ?? null;
	const sections = $derived.by<MenuSections>(() => {
		if (targets.length > 1) return selectionMenu(view, targets);
		const [only] = targets;
		return only ? rowMenu(view, only, sender(only) !== null) : [];
	});
	const menuLabel = $derived.by(() => {
		if (targets.length > 1) return t('mailbox.selectionActions', { count: targets.length });
		const [only] = targets;
		return only ? t('mailbox.actionsFor', { subject: only.subject || t('mailbox.noSubject') }) : undefined;
	});

	const LABELS: Record<RowAction, () => string> = {
		open: () => t('common.open'),
		openTab: () => t('mailbox.openInNewTab'),
		editDraft: () => t('mailbox.editDraft'),
		reply: () => t('thread.reply'),
		replyAll: () => t('thread.replyAll'),
		forward: () => t('thread.forward'),
		star: () => t('mailbox.star'),
		unstar: () => t('mailbox.unstar'),
		label: () => t('labels.apply'),
		archive: () => t('nav.archive'),
		unarchive: () => t('mailbox.moveToInbox'),
		read: () => t('mailbox.markRead'),
		unread: () => t('mailbox.markUnread'),
		copySender: () => t('mailbox.copySender'),
		withSender: () => {
			const person = targets[0] ? sender(targets[0]) : null;
			return t('mailbox.withSender', { name: person?.label || person?.address || '' });
		},
		spam: () => t('thread.reportSpam'),
		notspam: () => t('thread.notSpam'),
		trash: () => t('nav.bin'),
		restore: () => t('mailbox.restore'),
		delete: () => t('mailbox.deletePermanently')
	};
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
	const DANGER = new Set<RowAction>(['trash', 'delete']);

	async function show(next: ThreadSummary[], from: HTMLElement, place: (size: { width: number; height: number }) => { left: number; top: number }) {
		targets = next;
		openFor = next[0]?.thread_id ?? null;
		trigger = from;
		await tick();
		if (!menu) return;
		if (!menu.matches(':popover-open')) menu.showPopover();
		const { left, top } = place({ width: menu.offsetWidth, height: menu.offsetHeight });
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
	}

	const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

	/** Opens for `next` under the button pressed, or closes when that button's menu is already open. */
	export async function toggle(next: ThreadSummary, from: HTMLElement) {
		if (targets.length === 1 && targets[0].thread_id === next.thread_id) {
			close();
			return;
		}
		await show([next], from, (size) => placeMenu(from.getBoundingClientRect(), size, viewport()));
		items()[0]?.focus();
	}

	/**
	 * Opens at the pointer, like a desktop context menu. A right-click from the
	 * keyboard (the menu key, Shift+F10) has no pointer, so it opens under `from`.
	 */
	export async function openAt(next: ThreadSummary[], from: HTMLElement, point: { x: number; y: number } | null) {
		await show(next, from, (size) =>
			point ? placeAtPoint(point, size, viewport()) : placeMenu(from.getBoundingClientRect(), size, viewport())
		);
		// Focus the menu, not an item, so a mouse user sees no ring but the arrow keys still work.
		if (point) menu?.focus();
		else items()[0]?.focus();
	}

	/** Closes and, unless focus has already moved somewhere on purpose, hands it back to where it opened. */
	function close(returnFocus = true) {
		const from = trigger;
		targets = [];
		openFor = null;
		trigger = null;
		if (menu?.matches(':popover-open')) menu.hidePopover();
		if (returnFocus && from?.isConnected) from.focus({ preventScroll: true });
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
		if (targets.length === 0) return;
		const target = event.target as Node;
		if (menu?.contains(target)) return;
		// The ⋯ button toggles on its own click; a right-click anywhere else starts over.
		if (event.button === 0 && trigger?.contains(target) && trigger.matches('button')) return;
		close(false);
	}

	$effect(() => {
		if (targets.length === 0) return;
		// A menu left floating over rows that scrolled away would act on the wrong-looking row.
		const onScroll = (event: Event) => {
			if (!menu?.contains(event.target as Node)) close(false);
		};
		document.addEventListener('scroll', onScroll, { capture: true, passive: true });
		return () => document.removeEventListener('scroll', onScroll, { capture: true });
	});

	function choose(action: RowAction) {
		const chosen = targets;
		close(action !== 'openTab');
		if (chosen.length > 0) onAction(action, chosen);
	}
</script>

<svelte:document onpointerdown={onDocumentPointer} />
<svelte:window onresize={() => close(false)} onblur={() => close(false)} />

<!-- Manual rather than auto: the row's own button toggles it, which light dismiss would turn into close-then-reopen. -->
<div
	bind:this={menu}
	class="z-row-menu"
	popover="manual"
	role="menu"
	tabindex="-1"
	aria-label={menuLabel}
	onkeydown={onKeydown}
	oncontextmenu={(event) => event.preventDefault()}
>
	{#if targets.length > 1}
		<div class="z-row-menu-caption" role="none">{t('mailbox.selectionCount', { count: targets.length })}</div>
	{/if}
	{#each sections as section, index (section.join())}
		{#if index > 0}
			<div class="z-row-menu-divider" role="separator"></div>
		{/if}
		{#each section as action (action)}
			<button
				type="button"
				role="menuitem"
				tabindex="-1"
				class:danger={DANGER.has(action)}
				onclick={() => choose(action)}
			>
				<Icon name={ICONS[action]} size={16} class={action === 'unstar' ? 'z-star-on' : ''} />
				<span class="z-row-menu-label">{LABELS[action]()}</span>
			</button>
		{/each}
	{/each}
</div>
