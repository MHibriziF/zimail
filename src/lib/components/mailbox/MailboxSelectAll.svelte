<script lang="ts">
	import Icon from '../Icon.svelte';
	import Check from '../Check.svelte';
	import { t } from '$lib/i18n';
	import type { ThreadSummary } from '$lib/types';

	let {
		items,
		checked,
		indeterminate,
		selected = $bindable()
	}: {
		items: ThreadSummary[];
		checked: boolean;
		indeterminate: boolean;
		selected: string[];
	} = $props();

	let open = $state(false);

	function selectAll(next: boolean) {
		selected = next ? items.map((thread) => thread.latest_id) : [];
	}

	function selectWhere(predicate: (thread: ThreadSummary) => boolean) {
		selected = items.filter(predicate).map((thread) => thread.latest_id);
		open = false;
	}
</script>

<div class="select-all">
	<Check label={t('mailbox.selectAll')} {checked} {indeterminate} onchange={selectAll} />
	<button
		type="button"
		class="caret"
		aria-label={t('mailbox.selectionOptions')}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="arrow-down-s-line" size={14} />
	</button>

	{#if open}
		<button type="button" class="backdrop" aria-label={t('mailbox.closeMenu')} onclick={() => (open = false)}></button>
		<div class="menu menu-left" role="menu">
			<button type="button" class="menu-item" onclick={() => selectWhere(() => true)}>All</button>
			<button type="button" class="menu-item" onclick={() => selectWhere(() => false)}>None</button>
			<button type="button" class="menu-item" onclick={() => selectWhere((e) => !e.is_read)}>Unread</button>
			<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_read)}>Read</button>
			<button type="button" class="menu-item" onclick={() => selectWhere((e) => e.is_starred)}>Starred</button>
		</div>
	{/if}
</div>

<style>
	.select-all {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding-right: 0.25rem;
	}

	.caret {
		display: flex;
		align-items: center;
		color: var(--color-muted);
	}

	.caret:hover {
		color: var(--color-text);
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
	}

	.menu {
		position: absolute;
		top: calc(100% + 0.375rem);
		z-index: 30;
		min-width: 11rem;
		padding: 0.25rem;
		background: var(--color-surface);
		border-radius: 0.75rem;
		box-shadow: var(--shadow-md);
	}

	.menu-left {
		left: 0;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		text-align: left;
		transition: background 0.12s, color 0.12s;
	}

	.menu-item:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	@media (max-width: 900px) {
		.caret {
			width: var(--touch-target);
			height: var(--touch-target);
		}

		.backdrop {
			background: var(--color-scrim);
			animation: sheet-fade 180ms ease-out;
		}

		.menu {
			position: fixed;
			top: auto;
			right: 0;
			bottom: 0;
			left: 0;
			min-width: 0;
			padding: 0.5rem 1rem calc(1rem + env(safe-area-inset-bottom));
			border-radius: 1.25rem 1.25rem 0 0;
			animation: sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1);
		}

		.menu-left {
			left: 0;
			right: 0;
		}

		@keyframes sheet-up {
			from {
				transform: translateY(16%);
			}
		}

		@keyframes sheet-fade {
			from {
				opacity: 0;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.menu,
			.backdrop {
				animation: none;
			}
		}

		.menu-item {
			min-height: var(--touch-target);
			padding: 0.75rem 0.875rem;
			font-size: 0.9375rem;
		}
	}
</style>
