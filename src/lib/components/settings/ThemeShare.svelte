<script lang="ts">
	import { t } from '$lib/i18n';
	import { exportTheme, importTheme, type Appearance } from '$lib/ui-theme/appearance';

	let { appearance, onimport }: { appearance: Appearance; onimport: (next: Appearance) => void } = $props();

	let pasting = $state(false);
	let pasted = $state('');
	let message = $state('');
	let failed = $state(false);

	function say(text: string, error = false) {
		message = text;
		failed = error;
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
		onimport(theme);
		pasting = false;
		pasted = '';
		say(t('settings.themeImported'));
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

{#if message}
	<p class="message" class:failed role="status">{message}</p>
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
		border-radius: 0.625rem;
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
</style>
