<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import Icon from '../Icon.svelte';
	import PaletteEditor from './PaletteEditor.svelte';
	import ThemeShare from './ThemeShare.svelte';
	import { t } from '$lib/i18n';
	import {
		ACCENT_PRESETS,
		DEFAULT_APPEARANCE,
		applyAppearance,
		parseAccent,
		parseAppearance,
		type Appearance,
		type ChoiceKey
	} from '$lib/ui-theme/appearance';

	/** What the server has; the draft is what the screen shows while you try things. */
	const saved = $derived(parseAppearance($page.data.appearance));
	let draft = $state<Appearance>({ ...DEFAULT_APPEARANCE });
	let saving = $state(false);
	let error = $state('');
	let justSaved = $state(false);

	// Page data refreshes as mail syncs; only a different saved value should replace the draft.
	let savedKey = '';
	$effect(() => {
		const key = JSON.stringify(saved);
		if (key === savedKey) return;
		savedKey = key;
		draft = { ...saved };
	});

	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(saved));
	const isDefault = $derived(JSON.stringify(draft) === JSON.stringify(DEFAULT_APPEARANCE));
	/** The preset that matches, so the custom swatch only lights up for a colour of your own. */
	const accentValue = $derived(draft.accent ?? ACCENT_PRESETS[0]);
	const custom = $derived(!(ACCENT_PRESETS as readonly string[]).includes(accentValue));

	type Segment = { key: ChoiceKey; label: string; zeroOnly?: boolean; options: { value: string; label: string }[] };

	/** Each fixed choice as a row of buttons, in the order the panel shows them. */
	const SEGMENTS = $derived<{ heading: string; rows: Segment[] }[]>([
		{
			heading: t('settings.groupText'),
			rows: [
				{
					key: 'textSize',
					label: t('settings.textSize'),
					options: [
						{ value: 'small', label: t('settings.textSmall') },
						{ value: 'default', label: t('settings.textDefault') },
						{ value: 'large', label: t('settings.textLarge') }
					]
				},
				{
					key: 'font',
					label: t('settings.font'),
					options: [
						{ value: 'default', label: t('settings.fontDefault') },
						{ value: 'system', label: t('settings.fontSystem') },
						{ value: 'serif', label: t('settings.fontSerif') }
					]
				}
			]
		},
		{
			heading: t('settings.groupLayout'),
			rows: [
				{
					key: 'density',
					label: t('settings.density'),
					options: [
						{ value: 'comfortable', label: t('settings.densityComfortable') },
						{ value: 'compact', label: t('settings.densityCompact') }
					]
				},
				{
					key: 'preview',
					label: t('settings.preview'),
					options: [
						{ value: 'auto', label: t('settings.textDefault') },
						{ value: 'none', label: t('settings.previewNone') },
						{ value: 'one', label: t('settings.previewOne') },
						{ value: 'two', label: t('settings.previewTwo') }
					]
				},
				{
					key: 'radius',
					label: t('settings.radius'),
					options: [
						{ value: 'sharp', label: t('settings.radiusSharp') },
						{ value: 'default', label: t('settings.textDefault') },
						{ value: 'round', label: t('settings.radiusRound') }
					]
				},
				{
					key: 'sidebar',
					label: t('settings.sidebarWidth'),
					options: [
						{ value: 'narrow', label: t('settings.widthNarrow') },
						{ value: 'default', label: t('settings.textDefault') },
						{ value: 'wide', label: t('settings.widthWide') }
					]
				},
				{
					key: 'listWidth',
					label: t('settings.listWidth'),
					zeroOnly: true,
					options: [
						{ value: 'narrow', label: t('settings.widthNarrow') },
						{ value: 'default', label: t('settings.textDefault') },
						{ value: 'wide', label: t('settings.widthWide') }
					]
				}
			]
		}
	]);

	/** Classic has no list pane beside the reader, so its width has nothing to change there. */
	const zero = $derived(($page.data.uiTheme as string | undefined) === 'zero');

	function choose(key: ChoiceKey, value: string) {
		update({ [key]: value } as Partial<Appearance>);
	}

	function update(next: Partial<Appearance>) {
		draft = { ...draft, ...next };
		justSaved = false;
		error = '';
		applyAppearance(document.documentElement, draft);
	}

	function chooseAccent(value: string) {
		const accent = parseAccent(value);
		// The first preset is the theme's own accent, so picking it stores nothing.
		update({ accent: accent === ACCENT_PRESETS[0] ? null : accent });
	}

	async function save() {
		saving = true;
		error = '';
		try {
			const response = await fetch('/api/settings/appearance', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appearance: draft })
			});
			if (!response.ok) throw new Error(String(response.status));
			await invalidateAll();
			justSaved = true;
		} catch {
			error = t('settings.personaliseFailed');
		} finally {
			saving = false;
		}
	}

	// Leaving without saving puts the saved look back, so a preview never sticks by accident.
	onDestroy(() => {
		if (typeof document !== 'undefined' && dirty) applyAppearance(document.documentElement, saved);
	});
</script>

<section class="surface-lg card">
	<h2><Icon name="palette-line" size={18} /> {t('settings.personalise')}</h2>
	<p class="card-hint">{t('settings.personaliseHint')}</p>

	<fieldset class="group">
		<legend>{t('settings.accent')}</legend>
		<div class="swatches">
			{#each ACCENT_PRESETS as preset (preset)}
				<button
					type="button"
					class="swatch"
					class:selected={accentValue === preset}
					style:--swatch={preset}
					aria-pressed={accentValue === preset}
					aria-label={t('settings.accentSwatch', { color: preset })}
					onclick={() => chooseAccent(preset)}
				></button>
			{/each}
			<label class="swatch swatch-custom" class:selected={custom} style:--swatch={accentValue}>
				<input
					type="color"
					value={accentValue}
					aria-label={t('settings.accentCustom')}
					oninput={(event) => chooseAccent(event.currentTarget.value)}
				/>
				<Icon name="add-line" size={14} />
			</label>
		</div>
	</fieldset>

	<fieldset class="group">
		<legend>{t('settings.palette')}</legend>
		<PaletteEditor
			palettes={draft.palettes}
			accent={draft.accent}
			onpalettes={(palettes) => update({ palettes })}
			onpreset={(accent, palettes) => update({ accent, palettes })}
		/>
	</fieldset>

	{#each SEGMENTS as group (group.heading)}
		<h3 class="group-heading">{group.heading}</h3>
		{#each group.rows.filter((row) => zero || !row.zeroOnly) as row (row.key)}
			<fieldset class="group row">
				<legend>{row.label}</legend>
				<div class="segmented" role="radiogroup" aria-label={row.label}>
					{#each row.options as option (option.value)}
						<button
							type="button"
							role="radio"
							aria-checked={draft[row.key] === option.value}
							class={row.key === 'font' ? `font-${option.value}` : undefined}
							class:selected={draft[row.key] === option.value}
							onclick={() => choose(row.key, option.value)}>{option.label}</button
						>
					{/each}
				</div>
			</fieldset>
		{/each}
	{/each}

	<fieldset class="group">
		<legend>{t('settings.themeShare')}</legend>
		<ThemeShare appearance={draft} onimport={(theme) => update(theme)} />
	</fieldset>

	<div class="actions">
		<button type="button" class="btn-primary" disabled={!dirty || saving} onclick={save}>
			{saving ? t('common.saving') : t('common.save')}
		</button>
		<button type="button" class="btn-ghost" disabled={isDefault || saving} onclick={() => update({ ...DEFAULT_APPEARANCE })}>
			{t('settings.personaliseReset')}
		</button>
		<span class="status" role="status">
			{#if error}<span class="error">{error}</span>{:else if justSaved}{t('common.saved')}{/if}
		</span>
	</div>
</section>

<style>
	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	.card h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.card-hint {
		margin-top: 0.35rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.group {
		margin: 1.25rem 0 0;
		padding: 0;
		border: none;
	}

	.group-heading {
		margin: 1.75rem 0 0;
		padding-top: 1.25rem;
		border-top: 1px solid var(--color-line);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
	}

	/* Label and buttons on one line when there is room, so the long list stays scannable. */
	.group.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-top: 0.875rem;
	}

	.group.row legend {
		float: left;
		margin: 0;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	legend {
		margin-bottom: 0.5rem;
		padding: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: none;
		border-radius: 9999px;
		background: var(--swatch);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
		cursor: pointer;
	}

	.swatch.selected {
		box-shadow:
			0 0 0 2px var(--color-surface),
			0 0 0 4px var(--color-text);
	}

	.swatch-custom {
		background:
			conic-gradient(from 0deg, #e57373, #ffd54f, #81c784, #64b5f6, #ba68c8, #e57373);
		color: #111;
	}

	.swatch-custom.selected {
		background: var(--swatch);
		color: var(--color-on-accent);
	}

	.swatch-custom input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.swatch-custom:focus-within {
		outline: 2px solid var(--color-accent-text);
		outline-offset: 2px;
	}

	.segmented {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.25rem;
		border-radius: calc(0.75rem * var(--radius-scale, 1));
		background: var(--color-surface-muted);
	}

	.segmented button {
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

	.segmented button.selected {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--color-line);
	}

	/* Each font option is shown in its own face. */
	.font-default {
		font-family: 'Geist Variable', 'Geist', system-ui, sans-serif;
	}

	.font-system {
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	}

	.font-serif {
		font-family: Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.5rem;
	}

	.status {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.error {
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}

		.swatch {
			width: var(--touch-target);
			height: var(--touch-target);
		}

		.segmented button {
			min-height: var(--touch-target);
		}
	}
</style>
