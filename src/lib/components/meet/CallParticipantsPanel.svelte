<script lang="ts">
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { MAX_DISPLAY_NAME_LENGTH } from '$lib/meet/display-name';

	let {
		roster,
		onRename,
		onClose
	}: {
		roster: { identity: string; name: string; isLocal: boolean }[];
		/** Resolves to an error message, or '' once the new name is live. */
		onRename: (name: string) => Promise<string>;
		onClose: () => void;
	} = $props();

	let renaming = $state(false);
	let draftName = $state('');
	let renameError = $state('');
	let renameBusy = $state(false);

	function startRename(current: string) {
		draftName = current;
		renameError = '';
		renaming = true;
	}

	async function submitRename(event: SubmitEvent) {
		event.preventDefault();
		if (renameBusy) return;
		renameBusy = true;
		renameError = await onRename(draftName);
		renameBusy = false;
		if (!renameError) renaming = false;
	}

	function focusOnMount(el: HTMLInputElement) {
		el.focus();
		el.select();
	}

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
				{#if person.isLocal && renaming}
					<form class="call-rename" onsubmit={submitRename}>
						<input
							class="call-rename-input"
							type="text"
							bind:value={draftName}
							maxlength={MAX_DISPLAY_NAME_LENGTH}
							aria-label={t('meet.yourName')}
							onkeydown={(event) => event.key === 'Escape' && (renaming = false)}
							use:focusOnMount
						/>
						<div class="call-rename-actions">
							<button type="button" class="call-rename-btn" onclick={() => (renaming = false)}>{t('common.cancel')}</button>
							<button type="submit" class="call-rename-btn call-rename-save" disabled={renameBusy}>{t('common.save')}</button>
						</div>
						{#if renameError}<p class="call-rename-error">{renameError}</p>{/if}
					</form>
				{:else}
					<span class="call-participant-name">{person.name}{person.isLocal ? ` · ${t('meet.you')}` : ''}</span>
					{#if person.isLocal}
						<button
							type="button"
							class="call-panel-close call-rename-trigger"
							title={t('meet.rename')}
							aria-label={t('meet.rename')}
							onclick={() => startRename(person.name)}
						>
							<Icon name="pencil-line" size={16} />
						</button>
					{/if}
				{/if}
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

	.call-participant-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.call-rename-trigger {
		padding: 0.25rem;
		border-radius: 0.375rem;
	}

	.call-rename-trigger:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	.call-rename {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
	}

	.call-rename-input {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		color: #fff;
		background: rgba(255, 255, 255, 0.06);
	}

	.call-rename-input:focus {
		outline: none;
		border-color: rgba(255, 255, 255, 0.4);
	}

	.call-rename-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.375rem;
	}

	.call-rename-btn {
		padding: 0.25rem 0.625rem;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.8);
		background: rgba(255, 255, 255, 0.08);
		cursor: pointer;
	}

	.call-rename-save {
		color: #0b0b0d;
		background: #fff;
	}

	.call-rename-btn:disabled {
		opacity: 0.5;
	}

	.call-rename-error {
		margin: 0;
		font-size: 0.75rem;
		color: #f87171;
	}

	@media (max-width: 640px) {
		.call-panel {
			width: 100%;
			max-height: 45vh;
		}
	}
</style>
