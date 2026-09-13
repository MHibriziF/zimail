<script lang="ts">
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';

	let {
		roster,
		onClose
	}: {
		roster: { identity: string; name: string; isLocal: boolean }[];
		onClose: () => void;
	} = $props();

	function initialsFor(name: string): string {
		return (
			name
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.slice(0, 2)
				.map((part) => part[0]!.toUpperCase())
				.join('') || '?'
		);
	}

	/** A stable color per identity, so returning to a tile always looks the same. */
	function colorFor(seed: string): string {
		let hash = 0;
		for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
		return `hsl(${Math.abs(hash) % 360}, 45%, 38%)`;
	}
</script>

<div class="call-panel">
	<div class="call-panel-head">
		<strong>{t('meet.participants')} ({roster.length})</strong>
		<button type="button" class="call-panel-close" onclick={onClose} aria-label={t('meet.close')}>
			<Icon name="close-line" size={18} />
		</button>
	</div>
	<ul class="call-panel-list">
		{#each roster as person (person.identity)}
			<li class="call-participant-row">
				<span class="call-participant-avatar" style="background: {colorFor(person.identity)}">
					{initialsFor(person.name)}
				</span>
				<span>{person.name}{person.isLocal ? ` · ${t('meet.you')}` : ''}</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.call-panel {
		display: flex;
		flex-direction: column;
		width: 300px;
		flex-shrink: 0;
		border-radius: 0.75rem;
		background: #17171a;
		overflow: hidden;
	}

	.call-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		font-size: 0.875rem;
	}

	.call-panel-close {
		display: flex;
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
	}

	.call-panel-list {
		flex: 1;
		list-style: none;
		margin: 0;
		padding: 0.5rem;
		overflow-y: auto;
	}

	.call-participant-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.5rem;
		font-size: 0.8125rem;
		border-radius: 0.5rem;
	}

	.call-participant-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		font-weight: 600;
		flex-shrink: 0;
	}

	@media (max-width: 640px) {
		.call-panel {
			width: 100%;
			max-height: 45vh;
		}
	}
</style>
