<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';

	let {
		messages,
		onSend,
		onClose
	}: {
		messages: { id: string; from: string; text: string; isLocal: boolean }[];
		onSend: (text: string) => void;
		onClose: () => void;
	} = $props();

	let chatInput = $state('');
	let chatBodyEl = $state<HTMLDivElement>();

	async function scrollChatToEnd() {
		await tick();
		chatBodyEl?.scrollTo({ top: chatBodyEl.scrollHeight });
	}

	// Runs after the initial render too, so opening the panel already scrolled
	// to the bottom needs no separate call — this alone replaces the original's
	// explicit scrollChatToEnd() from togglePanel.
	$effect(() => {
		messages;
		void scrollChatToEnd();
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const text = chatInput.trim();
		if (!text) return;
		chatInput = '';
		onSend(text);
	}
</script>

<div class="call-panel">
	<div class="call-panel-head">
		<strong>{t('meet.chat')}</strong>
		<button type="button" class="call-panel-close" onclick={onClose} aria-label={t('meet.close')}>
			<Icon name="close-line" size={18} />
		</button>
	</div>
	<div class="call-chat-body" bind:this={chatBodyEl}>
		{#if messages.length === 0}
			<p class="call-chat-empty">{t('meet.noMessages')}</p>
		{:else}
			{#each messages as message (message.id)}
				<div class="call-chat-message" class:own={message.isLocal}>
					{#if !message.isLocal}<span class="call-chat-from">{message.from}</span>{/if}
					<span class="call-chat-text">{message.text}</span>
				</div>
			{/each}
		{/if}
	</div>
	<form class="call-chat-form" onsubmit={submit}>
		<input
			class="call-chat-input"
			type="text"
			bind:value={chatInput}
			maxlength={500}
			placeholder={t('meet.chatPlaceholder')}
		/>
		<button type="submit" class="call-chat-send" disabled={!chatInput.trim()}>{t('meet.send')}</button>
	</form>
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

	.call-chat-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		overflow-y: auto;
	}

	.call-chat-empty {
		margin: auto;
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.5);
	}

	.call-chat-message {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		max-width: 85%;
		padding: 0.375rem 0.625rem;
		border-radius: 0.75rem;
		background: rgba(255, 255, 255, 0.08);
		font-size: 0.8125rem;
		align-self: flex-start;
		word-break: break-word;
	}

	.call-chat-message.own {
		align-self: flex-end;
		background: var(--color-accent, #3b82f6);
	}

	.call-chat-from {
		font-size: 0.6875rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.6);
	}

	.call-chat-form {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.call-chat-input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.625rem;
		font-size: 0.8125rem;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
	}

	.call-chat-send {
		flex-shrink: 0;
		padding: 0.5rem 0.875rem;
		font-size: 0.8125rem;
		font-weight: 500;
		border: none;
		border-radius: 0.5rem;
		background: #26262b;
		color: #fff;
		cursor: pointer;
	}

	.call-chat-send:disabled {
		opacity: 0.5;
		cursor: default;
	}

	@media (max-width: 640px) {
		.call-panel {
			width: 100%;
			max-height: 45vh;
		}
	}
</style>
