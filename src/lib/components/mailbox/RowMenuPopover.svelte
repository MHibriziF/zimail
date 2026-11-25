<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { menuStep } from '$lib/mail/row-actions';

	type Size = { width: number; height: number };

	/**
	 * The behaviour every theme's row menu shares: a popover that opens beside a
	 * row, moves with the arrow keys, and closes on Escape, Tab, a click elsewhere,
	 * scrolling, resizing or leaving the window. Each theme draws the items.
	 */
	let {
		class: className,
		label,
		onclose,
		children
	}: {
		class: string;
		label?: string;
		/** Called whenever it closes, however that happened. */
		onclose: () => void;
		children: Snippet;
	} = $props();

	let menu = $state<HTMLDivElement | null>(null);
	let open = $state(false);
	let trigger: HTMLElement | null = null;

	const items = () => Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

	/**
	 * Opens where `place` puts it. A pointer-opened menu takes focus itself, so a
	 * mouse user sees no ring but the arrow keys still work; otherwise the first item does.
	 */
	export async function show(from: HTMLElement, place: (size: Size) => { left: number; top: number }, focusMenu = false) {
		trigger = from;
		open = true;
		await tick();
		if (!menu) return;
		if (!menu.matches(':popover-open')) menu.showPopover();
		const { left, top } = place({ width: menu.offsetWidth, height: menu.offsetHeight });
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;
		if (focusMenu) menu.focus();
		else items()[0]?.focus();
	}

	/** Closes and, unless focus has already moved somewhere on purpose, hands it back to where it opened. */
	export function close(returnFocus = true) {
		const from = trigger;
		trigger = null;
		open = false;
		if (menu?.matches(':popover-open')) menu.hidePopover();
		onclose();
		if (returnFocus && from?.isConnected) from.focus({ preventScroll: true });
	}

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
		if (!open) return;
		const target = event.target as Node;
		if (menu?.contains(target)) return;
		// A ⋯ button toggles on its own click; a right-click anywhere else starts over.
		if (event.button === 0 && trigger?.contains(target) && trigger.matches('button')) return;
		close(false);
	}

	$effect(() => {
		if (!open) return;
		// A menu left floating over rows that scrolled away would act on the wrong-looking row.
		const onScroll = (event: Event) => {
			if (!menu?.contains(event.target as Node)) close(false);
		};
		document.addEventListener('scroll', onScroll, { capture: true, passive: true });
		return () => document.removeEventListener('scroll', onScroll, { capture: true });
	});

	const dismiss = () => {
		if (open) close(false);
	};
</script>

<svelte:document onpointerdown={onDocumentPointer} />
<svelte:window onresize={dismiss} onblur={dismiss} />

<!-- Manual rather than auto: a row's own button toggles it, which light dismiss would turn into close-then-reopen. -->
<div
	bind:this={menu}
	class={className}
	popover="manual"
	role="menu"
	tabindex="-1"
	aria-label={label}
	onkeydown={onKeydown}
	oncontextmenu={(event) => event.preventDefault()}
>
	{@render children()}
</div>
