<script lang="ts">
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import ZeroIcon from '$themes/zero/icons/Icon.svelte';
	import { formatMailDate } from '$lib/utils/date';

	type Found = {
		id: string;
		threadId: string;
		direction: 'inbound' | 'outbound';
		from: string;
		to: string;
		subject: string;
		createdAt: string;
	};
	type Turn = { role: 'user' | 'assistant'; content: string; messages?: Found[] };

	let {
		open = $bindable(false),
		shell = 'classic'
	}: {
		open?: boolean;
		shell?: 'classic' | 'zero';
	} = $props();

	const ERRORS: Record<string, string> = {
		unavailable: 'ai.unavailable',
		limit_reached: 'ai.limitReached'
	};

	// Kept while the app is open, so a question survives opening one of the answers.
	let turns = $state<Turn[]>([]);
	let question = $state('');
	let busy = $state(false);
	let error = $state('');
	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let listEl = $state<HTMLElement | null>(null);

	const locale = $derived(($page.data.locale as string | undefined) ?? 'en');
	const timeZone = $derived(
		($page.data.timeZone as string | null | undefined) ?? Intl.DateTimeFormat().resolvedOptions().timeZone
	);

	$effect(() => {
		if (open) queueMicrotask(() => inputEl?.focus());
	});

	function scrollToEnd() {
		queueMicrotask(() => listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }));
	}

	async function ask(event?: SubmitEvent) {
		event?.preventDefault();
		const text = question.trim();
		if (!text || busy) return;
		const history = turns.map(({ role, content }) => ({ role, content }));
		turns = [...turns, { role: 'user', content: text }];
		question = '';
		busy = true;
		error = '';
		scrollToEnd();
		try {
			const response = await fetch('/api/ai/find', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ question: text, history, timeZone })
			});
			const body = (await response.json().catch(() => ({}))) as { answer?: string; messages?: Found[]; error?: string };
			if (!response.ok || !body.answer) {
				error = t(ERRORS[body.error ?? ''] ?? 'ai.failed');
				return;
			}
			turns = [...turns, { role: 'assistant', content: body.answer, messages: body.messages ?? [] }];
		} catch {
			error = t('common.networkError');
		} finally {
			busy = false;
			scrollToEnd();
		}
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void ask();
		}
	}

	function onPanelKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			open = false;
		}
	}

	function restart() {
		turns = [];
		error = '';
		inputEl?.focus();
	}

	function href(message: Found): string {
		if (shell === 'classic') return `/mail/${message.id}`;
		const folder = message.direction === 'outbound' ? '/sent' : '/inbox';
		return `${folder}?thread=${encodeURIComponent(message.id)}`;
	}

	/** "Budi Santoso <budi@x>" → "Budi Santoso"; sent mail shows who it went to. */
	function who(message: Found): string {
		const party = message.direction === 'outbound' ? message.to.split(',')[0] : message.from;
		const name = party.replace(/<[^>]*>/, '').trim();
		const label = name || party.trim();
		return message.direction === 'outbound' ? t('ai.askTo', { name: label }) : label;
	}
</script>

{#if open}
	<button type="button" class="ask-scrim" aria-label={t('common.close')} onclick={() => (open = false)}></button>
	<div class="ask" class:zero={shell === 'zero'} role="dialog" aria-label={t('ai.askTitle')} tabindex="-1" onkeydown={onPanelKey}>
		<header class="ask-head">
			<h2>{t('ai.askTitle')}</h2>
			{#if turns.length > 0}
				<button type="button" class="ask-icon" aria-label={t('ai.askNew')} title={t('ai.askNew')} onclick={restart}>
					{#if shell === 'zero'}<ZeroIcon name="Plus" size={14} />{:else}<Icon name="chat-new-line" size={17} />{/if}
				</button>
			{/if}
			<button type="button" class="ask-icon" aria-label={t('common.close')} onclick={() => (open = false)}>
				{#if shell === 'zero'}<ZeroIcon name="X" size={14} />{:else}<Icon name="close-line" size={18} />{/if}
			</button>
		</header>

		<div class="ask-list" bind:this={listEl} aria-live="polite">
			{#if turns.length === 0}
				<p class="ask-intro">{t('ai.askIntro')}</p>
			{/if}
			{#each turns as turn, index (index)}
				{#if turn.role === 'user'}
					<p class="ask-question">{turn.content}</p>
				{:else}
					<div class="ask-answer">
						<p>{turn.content}</p>
						{#each turn.messages ?? [] as message (message.id)}
							<a class="ask-card" href={href(message)} onclick={() => (open = false)}>
								<span class="ask-card-top">
									<span class="ask-card-who">{who(message)}</span>
									<span class="ask-card-date">{formatMailDate(message.createdAt, locale, timeZone)}</span>
								</span>
								<span class="ask-card-subject">{message.subject || t('mailbox.noSubject')}</span>
							</a>
						{/each}
					</div>
				{/if}
			{/each}
			{#if busy}<p class="ask-busy">{t('ai.askThinking')}</p>{/if}
			{#if error}<p class="ask-error" role="alert">{error}</p>{/if}
		</div>

		<form class="ask-form" onsubmit={ask}>
			<textarea
				bind:this={inputEl}
				bind:value={question}
				rows="2"
				maxlength="500"
				placeholder={t('ai.askPlaceholder')}
				aria-label={t('ai.askPlaceholder')}
				onkeydown={onKey}
			></textarea>
			<button type="submit" class="ask-send" disabled={busy || !question.trim()} aria-label={t('ai.askSend')}>
				{#if shell === 'zero'}<ZeroIcon name="PaperPlane" size={14} />{:else}<Icon name="send-plane-2-line" size={17} />{/if}
			</button>
		</form>
		<p class="ask-note">{t('ai.askNote')}</p>
	</div>
{/if}

<style>
	.ask {
		--ask-bg: var(--color-surface);
		--ask-line: var(--color-line);
		--ask-text: var(--color-text);
		--ask-muted: var(--color-muted);
		--ask-soft: var(--color-surface-muted);
		--ask-hover: var(--color-surface-hover);
		--ask-accent: var(--color-accent);
		--ask-on-accent: var(--color-on-accent);
		position: fixed;
		inset: 0 0 0 auto;
		z-index: 60;
		display: flex;
		flex-direction: column;
		width: min(26rem, 100vw);
		border-left: 1px solid var(--ask-line);
		background: var(--ask-bg);
		color: var(--ask-text);
		box-shadow: var(--shadow-md, -8px 0 24px rgba(0, 0, 0, 0.12));
	}

	.ask.zero {
		--ask-bg: var(--z-bg);
		--ask-line: var(--z-border);
		--ask-text: var(--z-fg);
		--ask-muted: var(--z-muted);
		--ask-soft: var(--z-hover);
		--ask-hover: var(--z-hover);
		--ask-accent: var(--z-primary);
		--ask-on-accent: var(--z-on-primary);
		font-size: 0.875rem;
	}

	.ask-scrim {
		position: fixed;
		inset: 0;
		z-index: 59;
		border: none;
		background: transparent;
	}

	.ask-head {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.75rem 0.75rem 0.75rem 1rem;
		border-bottom: 1px solid var(--ask-line);
	}

	.ask-head h2 {
		flex: 1;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.ask-icon {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: var(--ask-muted);
		--icon-color: var(--ask-muted);
		cursor: pointer;
	}

	.ask-icon:hover {
		background: var(--ask-hover);
		color: var(--ask-text);
		--icon-color: var(--ask-text);
	}

	.ask-list {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
	}

	.ask-intro,
	.ask-busy,
	.ask-note {
		margin: 0;
		color: var(--ask-muted);
		font-size: 0.8125rem;
	}

	.ask-question {
		align-self: flex-end;
		max-width: 85%;
		margin: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.875rem 0.875rem 0.25rem 0.875rem;
		background: var(--ask-accent);
		color: var(--ask-on-accent);
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.ask-answer {
		display: grid;
		gap: 0.5rem;
	}

	.ask-answer p {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
		line-height: 1.5;
	}

	.ask-card {
		display: grid;
		gap: 0.125rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--ask-line);
		border-radius: 0.625rem;
		color: inherit;
		text-decoration: none;
	}

	.ask-card:hover {
		background: var(--ask-hover);
	}

	.ask-card-top {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--ask-muted);
	}

	.ask-card-who {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ask-card-subject {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ask-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger, #d33);
	}

	.ask-form {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1rem 0.25rem;
		border-top: 1px solid var(--ask-line);
	}

	.ask-form textarea {
		flex: 1;
		resize: none;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--ask-line);
		border-radius: 0.625rem;
		background: var(--ask-soft);
		color: inherit;
		font: inherit;
	}

	.ask-send {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 0.625rem;
		background: var(--ask-accent);
		color: var(--ask-on-accent);
		--icon-color: var(--ask-on-accent);
		cursor: pointer;
	}

	.ask-send:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.ask-note {
		padding: 0.25rem 1rem 0.75rem;
		font-size: 0.75rem;
	}
</style>
