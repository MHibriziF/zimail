<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import type { MailAddress, MailboxFilters, MailboxView } from '$lib/types';

	let {
		view,
		filters,
		addresses,
		activeFilterCount,
		hasQuery,
		selecting,
		onStartSelecting,
		onCancelSelection,
		onRun,
		withParams
	}: {
		view: MailboxView;
		filters: MailboxFilters;
		addresses: MailAddress[];
		activeFilterCount: number;
		hasQuery: boolean;
		selecting: boolean;
		onStartSelecting: () => void;
		onCancelSelection: () => void;
		onRun: (action: string, ids: string[]) => void;
		withParams: (changes: Record<string, string | number | boolean | null>) => string;
	} = $props();

	let open = $state(false);

	function apply(changes: Record<string, string | number | boolean | null>) {
		goto(withParams(changes));
	}
</script>

<div class="more">
	<button
		type="button"
		class="tool-btn"
		aria-label={t('mailbox.mailboxActions')}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="more-line" size={16} />
	</button>

	{#if open}
		<button type="button" class="backdrop" aria-label={t('mailbox.closeMenu')} onclick={() => (open = false)}></button>
		<div class="menu menu-left" role="menu">
			{#if selecting}
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						onCancelSelection();
						open = false;
					}}
				>
					<Icon name="close-line" size={15} /> {t('mailbox.cancelSelection')}
				</button>
			{:else}
				<button
					type="button"
					class="menu-item"
					onclick={() => {
						onStartSelecting();
						open = false;
					}}
				>
					<Icon name="checkbox-multiple-line" size={15} /> Select
				</button>
			{/if}
			{#if addresses.length > 1}
				{#each addresses as address (address.id)}
					<button
						type="button"
						class="menu-item"
						onclick={() => apply({ address: filters.addressId === address.id ? null : address.id })}
					>
						<Icon
							name={filters.addressId === address.id ? 'radio-button-line' : 'checkbox-blank-circle-line'}
							size={15}
						/>
						{address.label || address.address}
					</button>
				{/each}
			{/if}
			<button type="button" class="menu-item" onclick={() => apply({ unread: filters.unreadOnly ? null : '1' })}>
				<Icon name={filters.unreadOnly ? 'checkbox-fill' : 'checkbox-blank-line'} size={15} />
				Unread only
			</button>
			<button type="button" class="menu-item" onclick={() => apply({ starred: filters.starredOnly ? null : '1' })}>
				<Icon name={filters.starredOnly ? 'checkbox-fill' : 'checkbox-blank-line'} size={15} />
				Starred only
			</button>
			<button type="button" class="menu-item" onclick={() => apply({ attachments: filters.attachmentsOnly ? null : '1' })}>
				<Icon name={filters.attachmentsOnly ? 'checkbox-fill' : 'checkbox-blank-line'} size={15} />
				Has attachments
			</button>
			{#if activeFilterCount > 0 || hasQuery}
				<button
					type="button"
					class="menu-item"
					onclick={() => apply({ unread: null, starred: null, attachments: null, address: null, q: null })}
				>
					<Icon name="close-circle-line" size={15} /> Clear filters
				</button>
			{/if}
			<button
				type="button"
				class="menu-item"
				onclick={() => {
					onRun('read-all', []);
					open = false;
				}}
			>
				<Icon name="mail-open-line" size={15} /> {t('mailbox.markAllRead')}
			</button>
			<button type="button" class="menu-item" onclick={() => invalidateAll()}>
				<Icon name="refresh-line" size={15} /> Refresh
			</button>
			{#if view === 'trash'}
				<button
					type="button"
					class="menu-item danger"
					onclick={() => {
						onRun('empty-trash', []);
						open = false;
					}}
				>
					<Icon name="delete-bin-2-line" size={15} /> {t('mailbox.emptyTrash')}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.more {
		position: relative;
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

	.menu-item.danger:hover {
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.tool-btn {
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
