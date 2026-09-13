<script lang="ts">
	import Icon from '../Icon.svelte';
	import type { Domain } from '$lib/types';

	let { domains }: { domains: Domain[] } = $props();
</script>

<section class="surface-lg card">
	<h2><Icon name="global-line" size={18} /> Connected domains</h2>
	<ul class="domain-list">
		{#each domains as domain (domain.id)}
			<li class="domain-row">
				<span class="domain-name">{domain.name}</span>
				<span class="caps">
					<span class="chip" class:chip-on={domain.sending_enabled}>send</span>
					<span class="chip" class:chip-on={domain.receiving_enabled}>receive</span>
					<span class="chip" class:chip-ok={domain.status === 'verified'}>{domain.status}</span>
				</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	.card h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.domain-list {
		margin-top: 1rem;
	}

	.domain-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0;
	}

	.domain-row + .domain-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.domain-name {
		font-size: 0.875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.caps {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.chip {
		padding: 0.0625rem 0.4375rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
	}

	.chip-on {
		color: var(--color-text-secondary);
	}

	.chip-ok {
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}
</style>
