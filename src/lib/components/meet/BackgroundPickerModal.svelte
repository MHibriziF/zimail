<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { createLocalVideoTrack, type LocalVideoTrack } from 'livekit-client';
	import { BackgroundProcessor } from '@livekit/track-processors';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';

	let {
		cameraDeviceId = '',
		initialOption = 'none',
		isLoggedIn = false,
		onapply,
		onclose
	}: {
		cameraDeviceId?: string;
		initialOption?: string;
		isLoggedIn?: boolean;
		onapply: (option: string) => void;
		onclose: () => void;
	} = $props();

	function gradientDataUrl(from: string, to: string): string {
		const canvas = document.createElement('canvas');
		canvas.width = 320;
		canvas.height = 180;
		const ctx = canvas.getContext('2d');
		if (!ctx) return '';
		const gradient = ctx.createLinearGradient(0, 0, 320, 180);
		gradient.addColorStop(0, from);
		gradient.addColorStop(1, to);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, 320, 180);
		return canvas.toDataURL('image/png');
	}

	/** Generated so there's no photo asset to source, host, or ship in the bundle. */
	const backgroundPresets = [
		{ url: gradientDataUrl('#1d4ed8', '#38bdf8'), swatch: 'linear-gradient(135deg, #1d4ed8, #38bdf8)' },
		{ url: gradientDataUrl('#15803d', '#4ade80'), swatch: 'linear-gradient(135deg, #15803d, #4ade80)' },
		{ url: gradientDataUrl('#c2410c', '#fbbf24'), swatch: 'linear-gradient(135deg, #c2410c, #fbbf24)' },
		{ url: gradientDataUrl('#27272a', '#71717a'), swatch: 'linear-gradient(135deg, #27272a, #71717a)' }
	];

	const PROCESSOR_OPTS = { maxFps: 20, segmenterOptions: { delegate: 'GPU' as const } };

	let previewMediaEl = $state<HTMLDivElement>();
	let previewError = $state('');
	let option = $state(untrack(() => initialOption));
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let saved = $state<{ id: string; url: string }[]>([]);

	let previewTrack: LocalVideoTrack | null = null;
	let ephemeralUrl: string | null = null;

	async function applyToPreview(value: string) {
		if (!previewTrack) return;
		try {
			if (value === 'none') {
				await previewTrack.stopProcessor();
			} else if (value === 'blur') {
				await previewTrack.setProcessor(BackgroundProcessor({ ...PROCESSOR_OPTS, mode: 'background-blur', blurRadius: 10 }));
			} else {
				await previewTrack.setProcessor(BackgroundProcessor({ ...PROCESSOR_OPTS, mode: 'virtual-background', imagePath: value }));
			}
		} catch {
			// Segmentation model failed to load (offline, blocked CDN) — the preview just stays unprocessed.
		}
	}

	function pick(value: string) {
		option = value;
		void applyToPreview(value);
	}

	async function loadSaved() {
		if (!isLoggedIn) return;
		try {
			const response = await fetch('/api/meet/backgrounds');
			if (!response.ok) return;
			const body = (await response.json()) as { backgrounds?: { id: string; url: string }[] };
			saved = (body.backgrounds ?? []).map((background) => ({ id: background.id, url: background.url }));
		} catch {
			// The gallery just stays empty — presets and upload still work.
		}
	}

	async function handleFile(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;

		if (ephemeralUrl) URL.revokeObjectURL(ephemeralUrl);
		ephemeralUrl = URL.createObjectURL(file);
		pick(ephemeralUrl);

		if (!isLoggedIn) return;

		uploading = true;
		try {
			const form = new FormData();
			form.append('file', file);
			const response = await fetch('/api/meet/backgrounds', { method: 'POST', body: form });
			if (response.ok) {
				const body = (await response.json()) as { id: string; url: string };
				saved = [{ id: body.id, url: body.url }, ...saved];
				// Swap the applied value to the durable URL so it survives a reload/rejoin.
				if (option === ephemeralUrl) option = body.url;
			}
		} catch {
			// Upload failed — the blob URL keeps the preview working for this session.
		} finally {
			uploading = false;
		}
	}

	async function removeSaved(id: string, event: MouseEvent) {
		event.stopPropagation();
		const target = saved.find((background) => background.id === id);
		saved = saved.filter((background) => background.id !== id);
		if (target && option === target.url) pick('none');
		try {
			await fetch(`/api/meet/backgrounds/${id}`, { method: 'DELETE' });
		} catch {
			// Already gone from the list either way; a failed delete just leaves an orphan row server-side.
		}
	}

	function apply() {
		onapply(option);
		onclose();
	}

	function onBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onclose();
	}

	onMount(() => {
		void loadSaved();
		(async () => {
			try {
				previewTrack = await createLocalVideoTrack(cameraDeviceId ? { deviceId: cameraDeviceId } : undefined);
				const el = previewTrack.attach();
				el.muted = true;
				el.style.transform = 'scaleX(-1)';
				previewMediaEl?.appendChild(el);
				if (option !== 'none') void applyToPreview(option);
			} catch {
				previewError = t('meet.deviceError');
			}
		})();
	});

	onDestroy(() => {
		previewTrack?.stop();
		if (ephemeralUrl) URL.revokeObjectURL(ephemeralUrl);
	});
</script>

<div class="modal-backdrop" role="presentation" onclick={onBackdropClick}>
	<div class="bgp-modal" role="dialog" aria-modal="true" aria-label={t('meet.background')} tabindex="-1">
		<div class="bgp-head">
			<h3><Icon name="image-2-line" size={16} />{t('meet.background')}</h3>
			<button type="button" class="bgp-icon-btn" aria-label={t('common.close')} onclick={onclose}>
				<Icon name="close-line" size={16} />
			</button>
		</div>

		<div class="bgp-preview">
			<div class="bgp-preview-media" bind:this={previewMediaEl}></div>
			{#if previewError}<p class="bgp-preview-error">{previewError}</p>{/if}
		</div>

		<div class="background-section">
			<button type="button" class="background-option" class:selected={option === 'none'} onclick={() => pick('none')}>
				{t('meet.backgroundNone')}
			</button>
			<button type="button" class="background-option" class:selected={option === 'blur'} onclick={() => pick('blur')}>
				{t('meet.backgroundBlur')}
			</button>
			<div class="background-swatches">
				{#each backgroundPresets as preset (preset.url)}
					<button
						type="button"
						class="background-swatch"
						class:selected={option === preset.url}
						style="background: {preset.swatch}"
						onclick={() => pick(preset.url)}
						aria-label={t('meet.backgroundPreset')}
					></button>
				{/each}
				{#each saved as background (background.id)}
					<button
						type="button"
						class="background-swatch background-swatch-saved"
						class:selected={option === background.url}
						style="background-image: url({background.url})"
						onclick={() => pick(background.url)}
						aria-label={t('meet.backgroundPreset')}
					>
						<span
							class="background-swatch-remove"
							role="button"
							tabindex="0"
							aria-label={t('meet.backgroundDelete')}
							onclick={(event) => removeSaved(background.id, event)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') removeSaved(background.id, event as unknown as MouseEvent);
							}}
						>
							<Icon name="close-line" size={10} />
						</span>
					</button>
				{/each}
				<button
					type="button"
					class="background-swatch background-swatch-upload"
					onclick={() => fileInput?.click()}
					disabled={uploading}
					aria-label={t('meet.backgroundUpload')}
				>
					<Icon name={uploading ? 'loader-4-line' : 'upload-2-line'} size={16} class={uploading ? 'bgp-spin' : ''} />
				</button>
			</div>
			<input type="file" accept="image/*" hidden bind:this={fileInput} onchange={handleFile} />
		</div>

		<div class="bgp-actions">
			<button type="button" class="bgp-btn" onclick={onclose}>{t('meet.backgroundCancel')}</button>
			<button type="button" class="bgp-btn primary" onclick={apply}>{t('meet.backgroundApply')}</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.6);
	}

	.bgp-modal {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 360px;
		padding: 1rem;
		border-radius: 0.875rem;
		background: #1c1c1f;
		color: #fff;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
	}

	.bgp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.bgp-head h3 {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.bgp-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 0.5rem;
		background: transparent;
		color: rgba(255, 255, 255, 0.7);
		cursor: pointer;
	}

	.bgp-icon-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}

	.bgp-preview {
		position: relative;
		aspect-ratio: 4 / 3;
		border-radius: 0.625rem;
		overflow: hidden;
		background: #0b0b0d;
	}

	.bgp-preview-media {
		width: 100%;
		height: 100%;
	}

	.bgp-preview-media :global(video) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.bgp-preview-error {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.75rem;
		margin: 0;
		text-align: center;
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.7);
	}

	/* Same look as the camera pill's background section it replaced, minus the width cap (this is a standalone popup now, not a dropdown). */
	.background-section {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.background-option {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: #fff;
		font-size: 0.8125rem;
		text-align: left;
		cursor: pointer;
	}

	.background-option:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.background-option.selected {
		background: rgba(255, 255, 255, 0.16);
		font-weight: 600;
	}

	.background-swatches {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 0.375rem;
		padding: 0.125rem 0 0.25rem;
	}

	.background-swatch {
		position: relative;
		aspect-ratio: 1;
		border: 2px solid transparent;
		border-radius: 0.5rem;
		background-size: cover;
		background-position: center;
		cursor: pointer;
	}

	.background-swatch.selected {
		border-color: #fff;
	}

	.background-swatch-remove {
		position: absolute;
		top: -0.3125rem;
		right: -0.3125rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border-radius: 999px;
		background: #dc2626;
		color: #fff;
		cursor: pointer;
	}

	.background-swatch-upload {
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}

	.background-swatch-upload:hover {
		background: rgba(255, 255, 255, 0.18);
	}

	:global(.bgp-spin) {
		animation: bgp-spin 1s linear infinite;
	}

	@keyframes bgp-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.bgp-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.bgp-btn {
		padding: 0.4375rem 0.875rem;
		border: none;
		border-radius: 0.5rem;
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}

	.bgp-btn:hover {
		background: rgba(255, 255, 255, 0.18);
	}

	.bgp-btn.primary {
		background: var(--color-accent, #3b82f6);
	}

	.bgp-btn.primary:hover {
		opacity: 0.9;
	}
</style>
