<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import type { MailAddress, MailboxFilters } from '$lib/types';

	let {
		filters,
		addresses,
		activeFilterCount,
		hasQuery,
		withParams
	}: {
		filters: MailboxFilters;
		addresses: MailAddress[];
		activeFilterCount: number;
		hasQuery: boolean;
		withParams: (changes: Record<string, string | number | boolean | null>) => string;
	} = $props();

	let open = $state(false);

	function apply(changes: Record<string, string | number | boolean | null>) {
		open = false;
		goto(withParams(changes));
	}
</script>

<div class="filter">
	<button
		type="button"
		class="pill"
		class:pill-on={activeFilterCount > 0}
		aria-label={t('common.filter')}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="equalizer-line" size={14} />
		<span class="filter-label">{t('common.filter')}</span>
		{#if activeFilterCount > 0}<span class="filter-count">{activeFilterCount}</span>{/if}
	</button>

	{#if open}
		<button type="button" class="backdrop" aria-label={t('mailbox.clearFilters')} onclick={() => (open = false)}></button>
		<div class="menu menu-right" role="menu">
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
					<Icon name="close-circle-line" size={15} /> Clear all
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.filter {
		position: relative;
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

	.filter-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1rem;
		height: 1rem;
		padding: 0 0.25rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--color-on-accent);
		background: var(--color-accent);
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

	.menu-right {
		right: 0;
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

		.menu-right {
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

		.pill {
			height: 2.25rem;
			padding: 0 0.875rem;
		}

		.filter-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}

		.filter .pill {
			position: relative;
			width: var(--touch-target);
			padding: 0;
			justify-content: center;
		}
	}
</style>
