<script lang="ts">
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import ZeroIcon from '$themes/zero/icons/Icon.svelte';
	import { formatMailDate, formatRelativeDate } from '$lib/utils/date';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	type Found = {
		id: string;
		threadId: string;
		direction: 'inbound' | 'outbound';
		from: string;
		to: string;
		subject: string;
		createdAt: string;
	};
	type FoundEvent = {
		id: string;
		title: string;
		start: string;
		end: string;
		allDay: boolean;
		location: string | null;
		calendar: string | null;
		day: string;
	};
	/** An event Ask AI prepared; nothing is saved until the user presses Add. */
	type Draft = {
		title: string;
		start: string;
		end: string;
		allDay: boolean;
		location: string | null;
		guests: string[];
		day: string;
		conflicts: string[];
		status?: 'adding' | 'added' | 'failed';
		error?: string;
	};
	type Turn = {
		role: 'user' | 'assistant';
		content: string;
		messages?: Found[];
		events?: FoundEvent[];
		drafts?: Draft[];
	};
	type Saved = { id: string; title: string; updatedAt: string };

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

	// Kept while the app is open, so a question survives opening one of the answers; saved on the
	// server too, so it survives a reload and can be reopened from History.
	let turns = $state<Turn[]>([]);
	let conversationId = $state<string | null>(null);
	let showHistory = $state(false);
	let saved = $state<Saved[] | null>(null);
	let historyError = $state('');
	let deleting = $state<string | null>(null);
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
		turns = [...turns, { role: 'user', content: text }];
		question = '';
		showHistory = false;
		busy = true;
		error = '';
		scrollToEnd();
		try {
			const response = await fetch('/api/ai/find', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ question: text, conversationId, timeZone })
			});
			const body = (await response.json().catch(() => ({}))) as {
				answer?: string;
				messages?: Found[];
				events?: FoundEvent[];
				drafts?: Draft[];
				conversationId?: string;
				error?: string;
			};
			if (!response.ok || !body.answer) {
				error = t(ERRORS[body.error ?? ''] ?? 'ai.failed');
				return;
			}
			conversationId = body.conversationId ?? conversationId;
			saved = null;
			turns = [
				...turns,
				{
					role: 'assistant',
					content: body.answer,
					messages: body.messages ?? [],
					events: body.events ?? [],
					drafts: body.drafts ?? []
				}
			];
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
		conversationId = null;
		error = '';
		showHistory = false;
		queueMicrotask(() => inputEl?.focus());
	}

	async function toggleHistory() {
		showHistory = !showHistory;
		if (!showHistory || saved) return;
		historyError = '';
		try {
			const response = await fetch('/api/ai/conversations');
			if (!response.ok) throw new Error(String(response.status));
			saved = ((await response.json()) as { conversations: Saved[] }).conversations;
		} catch {
			historyError = t('common.networkError');
		}
	}

	async function reopen(id: string) {
		historyError = '';
		try {
			const response = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`);
			if (!response.ok) throw new Error(String(response.status));
			const conversation = (await response.json()) as { id: string; turns: Turn[] };
			turns = conversation.turns;
			conversationId = conversation.id;
			error = '';
			showHistory = false;
			scrollToEnd();
		} catch {
			historyError = t('common.networkError');
		}
	}

	async function remove(id: string) {
		const response = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
		if (!response?.ok && response?.status !== 404) {
			historyError = t('common.networkError');
			return;
		}
		saved = (saved ?? []).filter((conversation) => conversation.id !== id);
		if (conversationId === id) {
			turns = [];
			conversationId = null;
		}
	}

	function href(message: Found): string {
		if (shell === 'classic') return `/mail/${message.id}`;
		const folder = message.direction === 'outbound' ? '/sent' : '/inbox';
		return `${folder}?thread=${encodeURIComponent(message.id)}`;
	}

	/** Saves a prepared event through the normal calendar API: the only way Ask AI's events get saved. */
	async function addDraft(draft: Draft) {
		if (draft.status === 'adding' || draft.status === 'added') return;
		draft.status = 'adding';
		draft.error = undefined;
		try {
			const response = await fetch('/api/calendar/events', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: draft.title,
					start: draft.start,
					end: draft.end,
					allDay: draft.allDay,
					location: draft.location ?? '',
					guests: draft.guests
				})
			});
			if (response.ok) {
				draft.status = 'added';
				return;
			}
			const body = (await response.json().catch(() => ({}))) as { error?: string };
			draft.status = 'failed';
			draft.error = body.error ?? t('ai.draftFailed');
		} catch {
			draft.status = 'failed';
			draft.error = t('common.networkError');
		}
	}

	/** "Thu, Oct 1 · 09:00 – 09:30" in the reader's zone; all-day events are floating dates. */
	function when(event: Pick<FoundEvent, 'start' | 'end' | 'allDay'>): string {
		if (event.allDay) {
			const day = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
			return `${day.format(new Date(event.start))} · ${t('calendar.allDay')}`;
		}
		const day = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone });
		const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
		return `${day.format(new Date(event.start))} · ${time.formatRange(new Date(event.start), new Date(event.end))}`;
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
			<h2>{showHistory ? t('ai.history') : t('ai.askTitle')}</h2>
			<button
				type="button"
				class="ask-icon"
				class:active={showHistory}
				aria-label={t('ai.history')}
				aria-pressed={showHistory}
				title={t('ai.history')}
				onclick={toggleHistory}
			>
				{#if shell === 'zero'}<ZeroIcon name="Clock" size={14} />{:else}<Icon name="history-line" size={17} />{/if}
			</button>
			<button
				type="button"
				class="ask-icon"
				class:active={turns.length === 0 && !showHistory}
				aria-label={t('ai.askNew')}
				title={t('ai.askNew')}
				onclick={restart}
			>
				{#if shell === 'zero'}<ZeroIcon name="Plus" size={14} />{:else}<Icon name="chat-new-line" size={17} />{/if}
			</button>
			<button type="button" class="ask-icon" aria-label={t('common.close')} onclick={() => (open = false)}>
				{#if shell === 'zero'}<ZeroIcon name="X" size={14} />{:else}<Icon name="close-line" size={18} />{/if}
			</button>
		</header>

		{#if showHistory}
			<div class="ask-list">
				{#if saved === null && !historyError}
					<p class="ask-intro">{t('common.loading')}</p>
				{:else if saved?.length === 0}
					<p class="ask-intro">{t('ai.historyEmpty')}</p>
				{/if}
				{#each saved ?? [] as conversation (conversation.id)}
					<div class="ask-saved" class:current={conversation.id === conversationId}>
						<button type="button" class="ask-saved-open" onclick={() => reopen(conversation.id)}>
							<span class="ask-card-subject">{conversation.title}</span>
							<span class="ask-card-date">{formatRelativeDate(conversation.updatedAt, locale, timeZone)}</span>
						</button>
						<button
							type="button"
							class="ask-icon"
							aria-label={t('ai.deleteConversation')}
							title={t('ai.deleteConversation')}
							onclick={() => (deleting = conversation.id)}
						>
							{#if shell === 'zero'}<ZeroIcon name="Trash" size={13} />{:else}<Icon name="delete-bin-line" size={15} />{/if}
						</button>
					</div>
				{/each}
				{#if historyError}<p class="ask-error" role="alert">{historyError}</p>{/if}
				<p class="ask-note">{t('ai.historyHint')}</p>
			</div>
		{:else}
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
						{#each turn.events ?? [] as event (event.id)}
							<a class="ask-card event" href="/calendar?day={event.day}" onclick={() => (open = false)}>
								<span class="ask-card-top">
									<span class="ask-card-who">{when(event)}</span>
									{#if event.calendar}<span class="ask-card-date">{event.calendar}</span>{/if}
								</span>
								<span class="ask-card-subject">{event.title}</span>
								{#if event.location}<span class="ask-card-place">{event.location}</span>{/if}
							</a>
						{/each}
						{#each turn.drafts ?? [] as draft, draftIndex (draftIndex)}
							<div class="ask-card event ask-draft">
								<span class="ask-card-top">
									<span class="ask-card-who">{when(draft)}</span>
									<span class="ask-card-date">{t('ai.draftNew')}</span>
								</span>
								<span class="ask-card-subject">{draft.title}</span>
								{#if draft.location}<span class="ask-card-place">{draft.location}</span>{/if}
								{#if draft.guests.length > 0}
									<span class="ask-draft-note">{t('ai.draftInvites', { guests: draft.guests.join(', ') })}</span>
								{/if}
								{#if draft.conflicts.length > 0}
									<span class="ask-draft-note warn">{t('ai.draftOverlaps', { events: draft.conflicts.join(', ') })}</span>
								{/if}
								{#if draft.status === 'added'}
									<a class="ask-draft-done" href="/calendar?day={draft.day}" onclick={() => (open = false)}>
										{t('ai.draftAdded')}
									</a>
								{:else}
									<button
										type="button"
										class="ask-draft-add"
										disabled={draft.status === 'adding'}
										onclick={() => addDraft(draft)}
									>
										{draft.status === 'adding' ? t('ai.draftAdding') : t('ai.draftAdd')}
									</button>
								{/if}
								{#if draft.status === 'failed'}<p class="ask-error" role="alert">{draft.error}</p>{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/each}
			{#if busy}<p class="ask-busy">{t('ai.askThinking')}</p>{/if}
			{#if error}<p class="ask-error" role="alert">{error}</p>{/if}
		</div>
		{/if}

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

<ConfirmDialog
	open={deleting !== null}
	title={t('ai.deleteConversationTitle')}
	message={t('ai.deleteConversationMessage')}
	confirmLabel={t('ai.deleteConversation')}
	onCancel={() => (deleting = null)}
	onConfirm={() => {
		if (deleting) void remove(deleting);
		deleting = null;
	}}
/>

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

	.ask-icon.active {
		background: var(--ask-hover);
		color: var(--ask-text);
		--icon-color: var(--ask-text);
	}

	.ask-saved {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--ask-line);
		border-radius: 0.625rem;
	}

	.ask-saved.current {
		border-color: var(--ask-accent);
	}

	.ask-saved-open {
		flex: 1;
		display: grid;
		gap: 0.125rem;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}

	.ask-saved-open .ask-card-date {
		font-size: 0.75rem;
		color: var(--ask-muted);
	}

	.ask-saved-open:hover {
		background: var(--ask-hover);
		border-radius: 0.625rem;
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

	/* An event reads as a calendar entry, not a message. */
	.ask-card.event {
		border-left: 3px solid var(--ask-accent);
	}

	.ask-card-place {
		font-size: 0.75rem;
		color: var(--ask-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ask-draft {
		gap: 0.25rem;
	}

	.ask-draft-note {
		font-size: 0.75rem;
		color: var(--ask-muted);
		overflow-wrap: anywhere;
	}

	.ask-draft-note.warn {
		color: var(--color-warning, #b26a00);
	}

	.ask-draft-add,
	.ask-draft-done {
		justify-self: start;
		margin-top: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.ask-draft-add {
		border: none;
		background: var(--ask-accent);
		color: var(--ask-on-accent);
		cursor: pointer;
	}

	.ask-draft-add:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.ask-draft-done {
		border: 1px solid var(--ask-line);
		color: inherit;
		text-decoration: none;
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
