<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import ZeroIcon from '$themes/zero/icons/Icon.svelte';
	import { htmlToPlainText } from '$lib/utils/html';

	let {
		html = $bindable(''),
		/** Left unbound for replies, whose subject is fixed. */
		subject = $bindable(),
		replyToId = null,
		shell = 'classic',
		placement = 'down',
		/** Classic only: a labelled pill beside Attach instead of a toolbar icon. */
		pill = false
	}: {
		html?: string;
		subject?: string;
		replyToId?: string | null;
		shell?: 'classic' | 'zero';
		placement?: 'up' | 'down';
		pill?: boolean;
	} = $props();

	const triggerClass = $derived.by(() => {
		if (shell === 'zero') return 'z-add';
		return pill ? 'ai-pill' : 'icon-btn';
	});

	type Action = 'write' | 'improve' | 'shorter' | 'formal' | 'friendly' | 'grammar';
	const REWRITES: { action: Action; label: string }[] = [
		{ action: 'improve', label: 'ai.improve' },
		{ action: 'shorter', label: 'ai.shorter' },
		{ action: 'formal', label: 'ai.formal' },
		{ action: 'friendly', label: 'ai.friendly' },
		{ action: 'grammar', label: 'ai.grammar' }
	];
	const ERRORS: Record<string, string> = {
		unavailable: 'ai.unavailable',
		limit_reached: 'ai.limitReached',
		not_found: 'ai.failed',
		failed: 'ai.failed'
	};

	let open = $state(false);
	let instruction = $state('');
	let busy = $state(false);
	let error = $state('');
	let previous = $state<{ html: string; subject: string | undefined } | null>(null);
	let rootEl = $state<HTMLElement | null>(null);
	let inputEl = $state<HTMLTextAreaElement | null>(null);

	const draftText = $derived(html.trim() ? htmlToPlainText(html) : '');

	function toggle() {
		open = !open;
		if (open) queueMicrotask(() => inputEl?.focus());
	}

	function onWindowClick(event: MouseEvent) {
		if (open && rootEl && !rootEl.contains(event.target as Node)) open = false;
	}

	async function run(action: Action) {
		if (busy) return;
		if (action === 'write' && !instruction.trim() && !draftText && !replyToId) {
			inputEl?.focus();
			return;
		}
		busy = true;
		error = '';
		try {
			const response = await fetch('/api/ai/compose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action,
					instruction: action === 'write' ? instruction : '',
					draft: draftText,
					subject: subject ?? '',
					replyToId
				})
			});
			const body = (await response.json().catch(() => ({}))) as { html?: string; subject?: string; error?: string };
			if (!response.ok || !body.html) {
				error = t(ERRORS[body.error ?? ''] ?? 'ai.failed');
				return;
			}
			previous = { html, subject };
			html = body.html;
			if (subject !== undefined && body.subject) subject = body.subject;
			if (action === 'write') instruction = '';
			// Out of the way so the new draft can be read; reopening offers Undo.
			open = false;
		} catch {
			error = t('common.networkError');
		} finally {
			busy = false;
		}
	}

	function undo() {
		if (!previous) return;
		html = previous.html;
		if (subject !== undefined && previous.subject !== undefined) subject = previous.subject;
		previous = null;
	}

	function onInputKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			event.stopPropagation();
			void run('write');
		}
		if (event.key === 'Escape') {
			event.stopPropagation();
			open = false;
		}
	}
</script>

<svelte:window onclick={onWindowClick} />

<div class="ai" class:zero={shell === 'zero'} bind:this={rootEl}>
	<button
		type="button"
		class={triggerClass}
		aria-label={t('ai.assist')}
		title={t('ai.assist')}
		aria-expanded={open}
		onclick={toggle}
	>
		{#if shell === 'zero'}
			<ZeroIcon name="Sparkles" size={12} />
			<span>{t('ai.assistShort')}</span>
		{:else if pill}
			<Icon name="sparkling-line" size={16} />
			<span>{t('ai.assist')}</span>
		{:else}
			<Icon name="sparkling-line" size={17} />
		{/if}
	</button>

	{#if open}
		<div class="ai-panel" class:up={placement === 'up'} role="dialog" aria-label={t('ai.assist')}>
			<textarea
				bind:this={inputEl}
				bind:value={instruction}
				rows="2"
				maxlength="500"
				placeholder={t(replyToId ? 'ai.replyPlaceholder' : 'ai.writePlaceholder')}
				disabled={busy}
				onkeydown={onInputKey}
			></textarea>
			<div class="ai-row">
				<button type="button" class="ai-primary" disabled={busy} onclick={() => run('write')}>
					{busy ? t('ai.working') : t(draftText && instruction.trim() ? 'ai.rewrite' : 'ai.write')}
				</button>
				{#if previous && !busy}
					<button type="button" class="ai-chip" onclick={undo}>{t('ai.undo')}</button>
				{/if}
			</div>
			{#if draftText}
				<div class="ai-row">
					{#each REWRITES as rewrite (rewrite.action)}
						<button type="button" class="ai-chip" disabled={busy} onclick={() => run(rewrite.action)}>
							{t(rewrite.label)}
						</button>
					{/each}
				</div>
			{/if}
			{#if error}<p class="ai-error" role="alert">{error}</p>{/if}
			<p class="ai-note">{t('ai.note')}</p>
		</div>
	{/if}
</div>

<style>
	.ai {
		--ai-bg: var(--color-surface);
		--ai-line: var(--color-line);
		--ai-text: var(--color-text);
		--ai-muted: var(--color-muted);
		--ai-hover: var(--color-surface-hover);
		--ai-accent: var(--color-accent);
		--ai-on-accent: var(--color-on-accent);
		position: relative;
		display: inline-flex;
	}

	.ai.zero {
		--ai-bg: var(--z-bg);
		--ai-line: var(--z-border);
		--ai-text: var(--z-fg);
		--ai-muted: var(--z-muted);
		--ai-hover: var(--z-hover);
		--ai-accent: var(--z-primary);
		--ai-on-accent: var(--z-on-primary);
	}

	.ai-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
		transition:
			background 0.15s,
			color 0.15s;
	}

	.ai-pill:hover,
	.ai-pill[aria-expanded='true'] {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.ai-panel {
		position: absolute;
		top: calc(100% + 0.375rem);
		right: 0;
		z-index: 30;
		display: grid;
		gap: 0.5rem;
		width: min(22rem, calc(100vw - 2rem));
		padding: 0.75rem;
		border: 1px solid var(--ai-line);
		border-radius: 0.75rem;
		background: var(--ai-bg);
		color: var(--ai-text);
		box-shadow: var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.12));
	}

	.ai-panel.up {
		top: auto;
		bottom: calc(100% + 0.375rem);
		right: auto;
		left: 0;
	}

	textarea {
		width: 100%;
		resize: vertical;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--ai-line);
		border-radius: 0.5rem;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.875rem;
	}

	.ai-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.ai-primary,
	.ai-chip {
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.ai-primary {
		border: none;
		background: var(--ai-accent);
		color: var(--ai-on-accent);
		font-weight: 600;
	}

	.ai-chip {
		border: 1px solid var(--ai-line);
		background: transparent;
		color: inherit;
	}

	.ai-chip:hover:not(:disabled) {
		background: var(--ai-hover);
	}

	.ai-primary:disabled,
	.ai-chip:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.ai-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger, #d33);
	}

	.ai-note {
		margin: 0;
		font-size: 0.75rem;
		color: var(--ai-muted);
	}
</style>
