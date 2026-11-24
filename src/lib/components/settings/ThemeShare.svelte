<script lang="ts">
	import { t } from '$lib/i18n';
	import { exportTheme, importTheme, type Appearance } from '$lib/ui-theme/appearance';

	let {
		appearance,
		onimport,
		undo = null
	}: {
		appearance: Appearance;
		onimport: (next: Appearance) => void;
		/** Puts back the look from before the last import, while that is still possible. */
		undo?: (() => void) | null;
	} = $props();

	/** An imported theme with custom CSS, held until its CSS has been seen. */
	let review = $state<Appearance | null>(null);

	let pasting = $state(false);
	let pasted = $state('');
	let message = $state('');
	let failed = $state(false);
	/** True while the message is about a theme just applied, which is what Undo can take back. */
	let applied = $state(false);

	function say(text: string, error = false) {
		message = text;
		failed = error;
		applied = false;
	}

	async function copy() {
		try {
			await navigator.clipboard.writeText(exportTheme(appearance));
			say(t('settings.themeCopied'));
		} catch {
			say(t('settings.themeCopyFailed'), true);
		}
	}

	function download() {
		const blob = new Blob([exportTheme(appearance)], { type: 'application/json' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = 'zimail-theme.json';
		link.click();
		URL.revokeObjectURL(link.href);
	}

	function load(text: string) {
		const theme = importTheme(text);
		if (!theme) {
			say(t('settings.themeImportInvalid'), true);
			return;
		}
		pasting = false;
		pasted = '';
		// Someone else's CSS runs on every page once saved, so it is shown before it applies.
		if (theme.customCss.trim() && theme.customCss !== appearance.customCss) {
			review = theme;
			message = '';
			return;
		}
		apply(theme);
	}

	function apply(theme: Appearance) {
		review = null;
		onimport(theme);
		say(t('settings.themeImported'));
		applied = true;
	}

	function undoImport() {
		undo?.();
		say(t('settings.themeImportUndone'));
	}

	async function fromFile(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (file) load(await file.text());
	}
</script>

<div class="share">
	<button type="button" class="btn-ghost" onclick={copy}>{t('settings.themeCopy')}</button>
	<button type="button" class="btn-ghost" onclick={download}>{t('settings.themeDownload')}</button>
	<label class="btn-ghost file">
		{t('settings.themeOpenFile')}
		<input type="file" accept="application/json,.json" onchange={fromFile} />
	</label>
	<button type="button" class="btn-ghost" aria-expanded={pasting} onclick={() => (pasting = !pasting)}>
		{t('settings.themePaste')}
	</button>
</div>

{#if pasting}
	<div class="paste">
		<textarea bind:value={pasted} rows="5" spellcheck="false" aria-label={t('settings.themePaste')}></textarea>
		<button type="button" class="btn-primary" disabled={!pasted.trim()} onclick={() => load(pasted)}>
			{t('settings.themeApply')}
		</button>
	</div>
{/if}

{#if review}
	<div class="review" role="group" aria-labelledby="theme-review-title">
		<p id="theme-review-title" class="review-title">{t('settings.themeReviewTitle')}</p>
		<p class="review-hint">{t('settings.themeReviewHint')}</p>
		<textarea class="review-css" readonly rows="8" spellcheck="false" aria-label={t('settings.customCss')} value={review.customCss}></textarea>
		<div class="review-actions">
			<button type="button" class="btn-primary" onclick={() => review && apply(review)}>{t('settings.themeApplyWithCss')}</button>
			<button
				type="button"
				class="btn-ghost"
				onclick={() => review && apply({ ...review, customCss: appearance.customCss })}>{t('settings.themeApplyWithoutCss')}</button
			>
			<button type="button" class="btn-ghost" onclick={() => (review = null)}>{t('common.cancel')}</button>
		</div>
	</div>
{/if}

{#if message}
	<p class="message" class:failed role="status">
		{message}
		{#if applied && undo}
			<button type="button" class="undo" onclick={undoImport}>{t('settings.personaliseUndo')}</button>
		{/if}
	</p>
{/if}

<style>
	.share {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.file {
		position: relative;
		cursor: pointer;
	}

	.file input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.file:focus-within {
		outline: 2px solid var(--color-accent-text);
		outline-offset: 2px;
	}

	.paste {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		margin-top: 0.75rem;
	}

	textarea {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border: none;
		border-radius: calc(0.625rem * var(--radius-scale, 1));
		background: var(--color-surface-muted);
		color: var(--color-text);
		font-family: var(--font-geist-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		resize: vertical;
	}

	.message {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.message.failed {
		color: var(--color-danger);
	}

	.undo {
		margin-left: 0.35rem;
		padding: 0;
		border: none;
		background: none;
		color: var(--color-accent-text);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.15em;
		cursor: pointer;
	}

	.review {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding: 0.875rem 1rem;
		border: 1px solid color-mix(in srgb, var(--color-text) 14%, transparent);
		border-radius: calc(0.75rem * var(--radius-scale, 1));
	}

	.review-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.review-hint {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.review-css {
		font-size: 0.75rem;
		line-height: 1.5;
	}

	.review-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
