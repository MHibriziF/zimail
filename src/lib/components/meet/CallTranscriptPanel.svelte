<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/stores';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { intlLocale, parseLocale } from '$lib/i18n/locales';
	import type { CaptionLine } from '$lib/meet/captions';
	import { CAPTION_LANGUAGE_CODES, languageNames } from '$lib/meet/caption-language';

	let {
		lines,
		timeZone,
		language,
		onSetLanguage,
		onDownload,
		onClose
	}: {
		lines: CaptionLine[];
		timeZone?: string;
		/** What this participant speaks, for their own captions only; `''` lets Whisper guess. */
		language: string;
		onSetLanguage: (code: string) => void;
		onDownload: (format: 'txt' | 'vtt') => void;
		onClose: () => void;
	} = $props();

	const nameOf = $derived(languageNames(intlLocale(parseLocale(($page.data as { locale?: string }).locale))));
	const languageOptions = $derived(
		CAPTION_LANGUAGE_CODES.map((code) => ({ code, name: nameOf(code) })).sort((a, b) => a.name.localeCompare(b.name))
	);

	let bodyEl = $state<HTMLDivElement>();
	/** Follows new lines only while the reader is already at the bottom, so scrolling back to reread isn't yanked away. */
	let following = true;

	const time = $derived(new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }));

	function onScroll() {
		if (!bodyEl) return;
		following = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 24;
	}

	$effect(() => {
		lines;
		if (!following) return;
		void tick().then(() => bodyEl?.scrollTo({ top: bodyEl.scrollHeight }));
	});
</script>

<div class="call-panel">
	<div class="call-panel-head">
		<strong>{t('meet.transcript')}</strong>
		<button type="button" class="call-panel-close" onclick={onClose} aria-label={t('meet.close')}>
			<Icon name="close-line" size={18} />
		</button>
	</div>
	<label class="call-transcript-language">
		<span class="call-transcript-language-label">{t('meet.captionLanguage')}</span>
		<select value={language} onchange={(event) => onSetLanguage(event.currentTarget.value)}>
			<option value="">{t('meet.captionLanguageAuto')}</option>
			{#each languageOptions as option (option.code)}
				<option value={option.code}>{option.name}</option>
			{/each}
		</select>
		<span class="call-transcript-language-hint">{t('meet.captionLanguageHint')}</span>
	</label>
	<div class="call-transcript-body" bind:this={bodyEl} onscroll={onScroll} aria-live="polite">
		{#if lines.length === 0}
			<p class="call-transcript-empty">{t('meet.transcriptEmpty')}</p>
		{:else}
			{#each lines as line (line.id)}
				<p class="call-transcript-line">
					<span class="call-transcript-meta">{line.name} · {time.format(line.at)}</span>
					<span>{line.text}</span>
				</p>
			{/each}
		{/if}
	</div>
	<div class="call-transcript-actions">
		<button type="button" disabled={lines.length === 0} onclick={() => onDownload('txt')}>
			<Icon name="download-2-line" size={16} />{t('meet.transcriptDownloadText')}
		</button>
		<button type="button" disabled={lines.length === 0} onclick={() => onDownload('vtt')}>
			<Icon name="closed-captioning-line" size={16} />{t('meet.transcriptDownloadSubtitles')}
		</button>
	</div>
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

	.call-transcript-language {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.call-transcript-language-label {
		font-size: 0.6875rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.55);
	}

	.call-transcript-language select {
		padding: 0.375rem 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: #fff;
		background: #26262b;
	}

	.call-transcript-language-hint {
		font-size: 0.6875rem;
		line-height: 1.4;
		color: rgba(255, 255, 255, 0.55);
	}

	.call-transcript-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.75rem 1rem;
		overflow-y: auto;
	}

	.call-transcript-empty {
		margin: auto;
		font-size: 0.8125rem;
		text-align: center;
		color: rgba(255, 255, 255, 0.5);
	}

	.call-transcript-line {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.45;
		word-break: break-word;
	}

	.call-transcript-meta {
		font-size: 0.6875rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.55);
	}

	.call-transcript-actions {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.call-transcript-actions button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: #fff;
		background: #26262b;
		cursor: pointer;
	}

	.call-transcript-actions button:hover:not(:disabled) {
		background: #34343a;
	}

	.call-transcript-actions button:disabled {
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
