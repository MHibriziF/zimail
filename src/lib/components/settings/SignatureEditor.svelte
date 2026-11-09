<script lang="ts">
	import Icon from '../Icon.svelte';
	import RichTextEditor from '../mailbox/RichTextEditor.svelte';
	import { t } from '$lib/i18n';
	import { cleanPastedHtml } from '$lib/mail/signature-paste';

	let {
		html = $bindable(''),
		placeholder = '',
		label
	}: {
		html?: string;
		placeholder?: string;
		label: string;
	} = $props();

	const UPLOAD_ERRORS: Record<string, string> = {
		too_large: 'settings.signatureImageTooLarge',
		not_an_image: 'settings.signatureImageType'
	};

	/** Widths offered for a picked image; `null` is its own size. */
	const SIZES = [
		{ label: 'settings.signatureImageSmall', width: 64 },
		{ label: 'settings.signatureImageMedium', width: 120 },
		{ label: 'settings.signatureImageLarge', width: 200 },
		{ label: 'settings.signatureImageOriginal', width: null }
	] as const;

	/** Inserted no wider than this, since a logo straight from a design file is often huge. */
	const DEFAULT_MAX_WIDTH = 200;

	let editor = $state<RichTextEditor | null>(null);
	let shell = $state<HTMLDivElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let sizePopover = $state<HTMLDivElement | null>(null);
	let picked: HTMLImageElement | null = null;
	let uploading = $state(false);
	let error = $state('');

	async function upload(file: File): Promise<string | null> {
		const res = await fetch('/api/settings/signature/images', {
			method: 'POST',
			headers: { 'Content-Type': file.type || 'application/octet-stream' },
			body: file
		});
		const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
		if (res.ok && body.url) return body.url;
		error = t(UPLOAD_ERRORS[body.error ?? ''] ?? 'settings.signatureImageFailed');
		return null;
	}

	function naturalWidth(url: string): Promise<number> {
		return new Promise((resolve) => {
			const image = new Image();
			image.onload = () => resolve(image.naturalWidth || DEFAULT_MAX_WIDTH);
			image.onerror = () => resolve(DEFAULT_MAX_WIDTH);
			image.src = url;
		});
	}

	async function addImages(files: File[]) {
		error = '';
		uploading = true;
		try {
			for (const file of files) {
				const url = await upload(file);
				if (!url) break;
				const width = Math.min(await naturalWidth(url), DEFAULT_MAX_WIDTH);
				editor?.insertHtml(`<img src="${url}" alt="" width="${width}">`);
			}
		} catch {
			error = t('common.networkError');
		} finally {
			uploading = false;
		}
	}

	function chooseFiles() {
		editor?.rememberSelection();
		fileInput?.click();
	}

	function onFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		if (files.length) void addImages(files);
	}

	function closeSizes() {
		if (sizePopover?.matches(':popover-open')) sizePopover.hidePopover();
	}

	function openSizes(image: HTMLImageElement) {
		if (!sizePopover) return;
		picked = image;
		const rect = image.getBoundingClientRect();
		sizePopover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 248))}px`;
		sizePopover.style.top = `${rect.bottom + 6}px`;
		sizePopover.showPopover();
	}

	function resize(width: number | null) {
		if (!picked) return;
		if (width) picked.setAttribute('width', String(width));
		else picked.removeAttribute('width');
		picked.removeAttribute('height');
		editor?.sync();
		closeSizes();
	}

	function removeImage() {
		picked?.remove();
		editor?.sync();
		closeSizes();
	}

	// A listener rather than an onclick on the wrapper, which is not itself something to click.
	$effect(() => {
		const element = shell;
		if (!element) return;
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (target instanceof HTMLImageElement && element.querySelector('[contenteditable]')?.contains(target)) {
				openSizes(target);
			}
		};
		element.addEventListener('click', onClick);
		return () => element.removeEventListener('click', onClick);
	});
</script>

<div bind:this={shell} class="signature-editor" aria-label={label} role="group">
	<RichTextEditor
		bind:this={editor}
		bind:html
		minHeight={120}
		{placeholder}
		cleanPaste={cleanPastedHtml}
		onpastefiles={(files) => void addImages(files)}
	>
		{#snippet toolbarExtra()}
			<button
				type="button"
				class="icon-btn"
				title={t('settings.signatureImageAdd')}
				aria-label={t('settings.signatureImageAdd')}
				disabled={uploading}
				onmousedown={(event) => event.preventDefault()}
				onclick={chooseFiles}
			>
				<Icon name={uploading ? 'loader-4-line' : 'image-add-line'} size={16} />
			</button>
		{/snippet}
	</RichTextEditor>

	<input
		bind:this={fileInput}
		type="file"
		accept="image/png,image/jpeg,image/gif,image/webp"
		multiple
		hidden
		onchange={onFiles}
	/>

	{#if error}<p class="signature-error" role="alert">{error}</p>{/if}

	<div bind:this={sizePopover} class="size-popover" popover="auto" role="dialog" aria-label={t('settings.signatureImageSize')}>
		{#each SIZES as size (size.label)}
			<button type="button" class="size-btn" onclick={() => resize(size.width)}>{t(size.label)}</button>
		{/each}
		<button type="button" class="size-btn size-remove" onclick={removeImage}>{t('settings.signatureImageRemove')}</button>
	</div>
</div>

<style>
	.signature-editor {
		border-radius: 0.75rem;
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.signature-editor :global(.editor-shell) {
		background: var(--color-surface-muted);
		box-shadow: none;
		border-radius: 0.75rem;
	}

	.signature-editor :global(.editor img) {
		cursor: pointer;
	}

	.signature-error {
		padding: 0 0.875rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.size-popover {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0.375rem;
		border: none;
		border-radius: 0.75rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: 0 0 0 1px var(--color-line), 0 12px 32px rgba(0, 0, 0, 0.18);
	}

	.size-popover:popover-open {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		max-width: 240px;
	}

	.size-btn {
		height: 2rem;
		padding: 0 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
	}

	.size-btn:hover {
		background: var(--color-surface-muted);
	}

	.size-remove {
		color: var(--color-danger);
	}
</style>
