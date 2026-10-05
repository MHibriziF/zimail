<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/stores';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { intlLocale, parseLocale } from '$lib/i18n/locales';
	import type { CaptionLine } from '$lib/meet/captions';
	import { CAPTION_LANGUAGE_CODES, MAX_CAPTION_LANGUAGES, languageNames } from '$lib/meet/caption-language';

	let {
		lines,
		timeZone,
		languages,
		onSetLanguages,
		onDownload,
		onClose
	}: {
		lines: CaptionLine[];
		timeZone?: string;
		/** What this participant speaks, for their own captions only; empty lets Whisper guess. */
		languages: string[];
		onSetLanguages: (codes: string[]) => void;
		onDownload: (format: 'txt' | 'vtt') => void;
		onClose: () => void;
	} = $props();

	let languagesOpen = $state(false);
	const nameOf = $derived(languageNames(intlLocale(parseLocale(($page.data as { locale?: string }).locale))));
	const languageOptions = $derived(
		CAPTION_LANGUAGE_CODES.map((code) => ({ code, name: nameOf(code) })).sort((a, b) => a.name.localeCompare(b.name))
	);
	const languageSummary = $derived(
		languages.length === 0 ? t('meet.captionLanguageAuto') : languages.map(nameOf).join(', ')
	);
	const languagesFull = $derived(languages.length >= MAX_CAPTION_LANGUAGES);

	function toggleLanguage(code: string, on: boolean) {
		onSetLanguages(on ? [...languages, code] : languages.filter((picked) => picked !== code));
	}

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
	<div class="call-transcript-language">
		<span class="call-transcript-language-label">{t('meet.captionLanguage')}</span>
		<button
			type="button"
			class="call-transcript-language-toggle"
			aria-expanded={languagesOpen}
			onclick={() => (languagesOpen = !languagesOpen)}
		>
			<span>{languageSummary}</span>
			<Icon name={languagesOpen ? 'arrow-up-s-line' : 'arrow-down-s-line'} size={16} />
		</button>
		{#if languagesOpen}
			<p class="call-transcript-language-hint">{t('meet.captionLanguageHint', { max: MAX_CAPTION_LANGUAGES })}</p>
			<div class="call-transcript-language-list">
				{#each languageOptions as option (option.code)}
					{@const checked = languages.includes(option.code)}
					<label class:call-transcript-language-off={!checked && languagesFull}>
						<input
							type="checkbox"
							{checked}
							disabled={!checked && languagesFull}
							onchange={(event) => toggleLanguage(option.code, event.currentTarget.checked)}
						/>
						{option.name}
					</label>
				{/each}
			</div>
		{/if}
	</div>
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

	.call-transcript-language-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		text-align: left;
		color: #fff;
		background: #26262b;
		cursor: pointer;
	}

	.call-transcript-language-hint {
		margin: 0;
		font-size: 0.6875rem;
		line-height: 1.4;
		color: rgba(255, 255, 255, 0.55);
	}

	.call-transcript-language-list {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.125rem 0.5rem;
		max-height: 10rem;
		overflow-y: auto;
		font-size: 0.75rem;
	}

	.call-transcript-language-list label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.1875rem 0;
		cursor: pointer;
	}

	.call-transcript-language-list input {
		accent-color: #4f8cff;
	}

	.call-transcript-language-off {
		opacity: 0.45;
		cursor: default;
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
