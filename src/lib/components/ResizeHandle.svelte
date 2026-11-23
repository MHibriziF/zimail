<script lang="ts">
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import { t } from '$lib/i18n';
	import {
		applyPanes,
		clampPane,
		PANE_LIMITS,
		parseAppearance,
		type PaneKey
	} from '$lib/ui-theme/appearance';

	/**
	 * A drag handle on a pane's edge. Dragging (or the arrow keys) resizes the pane live, and the
	 * width is saved once, when the drag ends, so it follows the account like the rest of Personalise.
	 * Double-click goes back to the width chosen in Personalise.
	 */
	let {
		pane,
		target,
		label,
		class: className = ''
	}: {
		pane: PaneKey;
		/** The pane being resized, measured when a drag starts. */
		target: () => HTMLElement | null | undefined;
		label: string;
		class?: string;
	} = $props();

	const STEP = 16;
	const DIRECTION: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
	const saved = $derived(parseAppearance($page.data.appearance));
	let width = $state<number | null>(null);
	let drag: { startX: number; startWidth: number; moved: boolean } | null = null;
	let keyTimer: ReturnType<typeof setTimeout> | undefined;
	/** When the last press began, to tell a double-click from two drags (pointer capture hides dblclick). */
	let lastPress = 0;
	const DOUBLE_PRESS_MS = 400;

	function current(): number {
		return Math.round(target()?.getBoundingClientRect().width ?? PANE_LIMITS[pane].min);
	}

	function preview(next: number | null) {
		width = next;
		applyPanes(document.documentElement, { [pane]: next });
	}

	async function save(next: number | null) {
		try {
			const response = await fetch('/api/settings/appearance', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ panes: { [pane]: next } })
			});
			if (response.ok) await invalidateAll();
		} catch {
			// The width still applies for this visit; the next drag tries again.
		}
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		event.preventDefault();
		const now = event.timeStamp;
		if (now - lastPress < DOUBLE_PRESS_MS) {
			lastPress = 0;
			reset();
			return;
		}
		lastPress = now;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		drag = { startX: event.clientX, startWidth: current(), moved: false };
		document.documentElement.dataset.resizing = '';
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag) return;
		const delta = event.clientX - drag.startX;
		if (Math.abs(delta) > 2) drag.moved = true;
		if (drag.moved) preview(clampPane(pane, drag.startWidth + delta));
	}

	function onPointerUp() {
		if (!drag) return;
		const moved = drag.moved;
		drag = null;
		delete document.documentElement.dataset.resizing;
		if (moved && width !== null) void save(width);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Home' || event.key === 'Escape') {
			event.preventDefault();
			reset();
			return;
		}
		const step = event.shiftKey ? STEP * 3 : STEP;
		const direction = DIRECTION[event.key] ?? 0;
		if (!direction) return;
		event.preventDefault();
		const next = clampPane(pane, (width ?? current()) + direction * step);
		preview(next);
		// Arrow keys repeat; save when they stop rather than on every press.
		clearTimeout(keyTimer);
		keyTimer = setTimeout(() => void save(next), 600);
	}

	function reset() {
		preview(null);
		void save(null);
	}
</script>

<!-- A focusable separator with a value is the ARIA window-splitter pattern, which Svelte does not know is interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="resize-handle {className}"
	role="separator"
	aria-orientation="vertical"
	aria-label={label}
	title={t('common.resizeHint')}
	aria-valuemin={PANE_LIMITS[pane].min}
	aria-valuemax={PANE_LIMITS[pane].max}
	aria-valuenow={width ?? saved[pane] ?? undefined}
	tabindex="0"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onkeydown={onKeydown}
></div>

<style>
	.resize-handle {
		position: relative;
		z-index: 5;
		width: 0.625rem;
		cursor: col-resize;
		touch-action: none;
		outline: none;
	}

	/* A hairline that only appears when the edge is in use, so it never adds a line to the layout. */
	.resize-handle::after {
		content: '';
		position: absolute;
		top: 0.5rem;
		bottom: 0.5rem;
		left: 50%;
		width: 2px;
		border-radius: 999px;
		background: var(--color-accent);
		opacity: 0;
		transform: translateX(-50%);
		transition: opacity 0.12s ease;
	}

	.resize-handle:hover::after,
	.resize-handle:focus-visible::after,
	:global(:root[data-resizing]) .resize-handle::after {
		opacity: 1;
	}

	.resize-handle:focus-visible::after {
		background: var(--color-accent-text);
	}

	@media (hover: none), (max-width: 767px) {
		.resize-handle {
			display: none;
		}
	}
</style>
