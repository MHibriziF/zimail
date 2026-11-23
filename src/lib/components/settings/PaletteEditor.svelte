<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import { readThemePreference, resolveTheme } from '$lib/theme';
	import {
		contrastRatio,
		PALETTE_PRESETS,
		PALETTE_SLOTS,
		parseHex,
		THEME_DEFAULTS,
		type Mode,
		type PaletteSlot,
		type Palettes
	} from '$lib/ui-theme/palette';

	let {
		palettes,
		accent,
		onpalettes,
		onpreset
	}: {
		palettes: Palettes;
		accent: string | null;
		onpalettes: (next: Palettes) => void;
		onpreset: (accent: string | null, palettes: Palettes) => void;
	} = $props();

	const defaults = $derived(THEME_DEFAULTS[($page.data.uiTheme as string) ?? 'zero'] ?? THEME_DEFAULTS.zero);

	/** The mode being edited is also the one on screen, so every change can be seen as it is made. */
	let mode = $state<Mode>('light');
	let original: string | undefined;
	$effect(() => {
		original = document.documentElement.dataset.theme;
		mode = original === 'dark' ? 'dark' : 'light';
	});

	function showMode(next: Mode) {
		mode = next;
		document.documentElement.dataset.theme = next;
	}

	onDestroy(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.dataset.theme = original ?? resolveTheme(readThemePreference());
	});

	const SLOT_LABELS = $derived<Record<PaletteSlot, string>>({
		background: t('settings.paletteBackground'),
		surface: t('settings.paletteSurface'),
		raised: t('settings.paletteRaised'),
		text: t('settings.paletteText'),
		muted: t('settings.paletteMuted'),
		border: t('settings.paletteBorder')
	});

	const effective = $derived({ ...defaults[mode], ...palettes[mode] });

	/** Readability of the pairs people actually read, flagged under the WCAG minimum. */
	const warnings = $derived(
		[
			{ fg: 'text', bg: 'surface', min: 4.5 },
			{ fg: 'text', bg: 'background', min: 4.5 },
			{ fg: 'muted', bg: 'surface', min: 4.5 },
			{ fg: 'muted', bg: 'background', min: 4.5 }
		]
			.map((pair) => ({
				...pair,
				ratio: contrastRatio(effective[pair.fg as PaletteSlot], effective[pair.bg as PaletteSlot])
			}))
			.filter((pair) => pair.ratio < pair.min)
	);

	function setSlot(slot: PaletteSlot, value: string) {
		const hex = parseHex(value);
		if (!hex) return;
		onpalettes({ ...palettes, [mode]: { ...palettes[mode], [slot]: hex } });
	}

	function clearSlot(slot: PaletteSlot) {
		const next = { ...palettes[mode] };
		delete next[slot];
		onpalettes({ ...palettes, [mode]: next });
	}

	const activePreset = $derived(
		PALETTE_PRESETS.find(
			(preset) => preset.accent === accent && JSON.stringify(preset.palettes) === JSON.stringify(palettes)
		)?.id ?? (Object.keys(palettes.light).length + Object.keys(palettes.dark).length === 0 ? 'default' : null)
	);
</script>

<div class="presets" role="radiogroup" aria-label={t('settings.palettePresets')}>
	<button
		type="button"
		role="radio"
		aria-checked={activePreset === 'default'}
		class="preset"
		class:selected={activePreset === 'default'}
		onclick={() => onpreset(null, { light: {}, dark: {} })}
	>
		<span class="preset-chips">
			{#each ['background', 'surface', 'text'] as const as slot (slot)}
				<span style:background={defaults[mode][slot]}></span>
			{/each}
		</span>
		<span class="preset-name">{t('settings.paletteThemeDefault')}</span>
	</button>
	{#each PALETTE_PRESETS as preset (preset.id)}
		<button
			type="button"
			role="radio"
			aria-checked={activePreset === preset.id}
			class="preset"
			class:selected={activePreset === preset.id}
			onclick={() => onpreset(preset.accent, preset.palettes)}
		>
			<span class="preset-chips">
				<span style:background={preset.palettes[mode].background}></span>
				<span style:background={preset.palettes[mode].surface}></span>
				<span style:background={preset.accent}></span>
			</span>
			<span class="preset-name">{t(`settings.palettePreset_${preset.id}`)}</span>
		</button>
	{/each}
</div>

<div class="modes" role="tablist" aria-label={t('settings.paletteMode')}>
	{#each ['light', 'dark'] as const as option (option)}
		<button
			type="button"
			role="tab"
			aria-selected={mode === option}
			class:selected={mode === option}
			onclick={() => showMode(option)}
		>
			{option === 'light' ? t('settings.paletteLight') : t('settings.paletteDark')}
		</button>
	{/each}
</div>

<ul class="slots">
	{#each PALETTE_SLOTS as slot (slot)}
		{@const own = palettes[mode][slot]}
		<li>
			<label class="slot-swatch" style:background={effective[slot]}>
				<input
					type="color"
					value={effective[slot]}
					aria-label={SLOT_LABELS[slot]}
					oninput={(event) => setSlot(slot, event.currentTarget.value)}
				/>
			</label>
			<span class="slot-label">{SLOT_LABELS[slot]}</span>
			<input
				class="slot-hex"
				value={effective[slot]}
				aria-label={`${SLOT_LABELS[slot]} hex`}
				spellcheck="false"
				onchange={(event) => setSlot(slot, event.currentTarget.value)}
			/>
			<button
				type="button"
				class="slot-reset"
				disabled={!own}
				aria-label={`${t('settings.paletteUseDefault')}: ${SLOT_LABELS[slot]}`}
				title={t('settings.paletteUseDefault')}
				onclick={() => clearSlot(slot)}
			>
				<Icon name="arrow-go-back-line" size={16} />
			</button>
		</li>
	{/each}
</ul>

{#if warnings.length > 0}
	<ul class="warnings" role="status">
		{#each warnings as warning (`${warning.fg}-${warning.bg}`)}
			<li>
				{t('settings.paletteLowContrast', {
					fg: SLOT_LABELS[warning.fg as PaletteSlot],
					bg: SLOT_LABELS[warning.bg as PaletteSlot],
					ratio: warning.ratio.toFixed(1)
				})}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.presets {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
		gap: 0.5rem;
	}

	.preset {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.625rem;
		border: none;
		border-radius: calc(0.75rem * var(--radius-scale, 1));
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-line);
		color: var(--color-text-secondary);
		text-align: left;
		cursor: pointer;
	}

	.preset:hover {
		background: var(--color-surface-muted);
	}

	.preset.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent-text);
		color: var(--color-text);
	}

	.preset-chips {
		display: flex;
	}

	.preset-chips span {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		box-shadow: 0 0 0 2px var(--color-surface), inset 0 0 0 1px rgba(127, 127, 127, 0.3);
	}

	.preset-chips span + span {
		margin-left: -0.3rem;
	}

	.preset-name {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.modes {
		display: inline-flex;
		gap: 0.25rem;
		margin-top: 1rem;
		padding: 0.25rem;
		border-radius: calc(0.75rem * var(--radius-scale, 1));
		background: var(--color-surface-muted);
	}

	.modes button {
		min-height: 2rem;
		padding: 0 0.875rem;
		border: none;
		border-radius: calc(0.5rem * var(--radius-scale, 1));
		background: none;
		color: var(--color-text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
	}

	.modes button.selected {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.slots {
		display: grid;
		gap: 0.25rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}

	.slots li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 6.5rem auto;
		align-items: center;
		gap: 0.75rem;
		min-height: 2.75rem;
	}

	.slot-swatch {
		position: relative;
		width: 2rem;
		height: 2rem;
		border-radius: calc(0.5rem * var(--radius-scale, 1));
		box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.35);
		cursor: pointer;
	}

	.slot-swatch:focus-within {
		outline: 2px solid var(--color-accent-text);
		outline-offset: 2px;
	}

	.slot-swatch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.slot-label {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.slot-hex {
		width: 100%;
		min-height: 2rem;
		padding: 0 0.5rem;
		border: none;
		border-radius: calc(0.5rem * var(--radius-scale, 1));
		background: var(--color-surface-muted);
		color: var(--color-text);
		font-family: var(--font-geist-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.slot-reset {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: calc(0.5rem * var(--radius-scale, 1));
		background: none;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.slot-reset:hover {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.slot-reset:disabled {
		visibility: hidden;
	}

	.warnings {
		margin: 0.75rem 0 0;
		padding: 0.625rem 0.75rem;
		border-radius: calc(0.625rem * var(--radius-scale, 1));
		background: var(--tone-warn-bg);
		color: var(--tone-warn-fg);
		font-size: 0.8125rem;
		list-style: none;
	}

	@media (max-width: 900px) {
		.slots li {
			grid-template-columns: auto minmax(0, 1fr) 5.75rem auto;
			gap: 0.5rem;
		}

		.slot-reset {
			width: var(--touch-target);
			height: var(--touch-target);
		}

		.slot-swatch {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}
</style>
