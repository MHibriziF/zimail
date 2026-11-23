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
		MAX_CUSTOM_CSS,
		applyAppearance,
		parseAccent,
		parseAppearance,
		type Appearance,
		type ChoiceKey
	} from '$lib/ui-theme/appearance';

	/**
	 * Every change shows at once and saves itself shortly after, like the theme and language
	 * pickers above: nothing to remember to press, and nothing lost by leaving the page.
	 */
	const SAVE_DELAY_MS = 700;

	const saved = $derived(parseAppearance($page.data.appearance));
	let draft = $state<Appearance>({ ...DEFAULT_APPEARANCE });
	let status = $state<'idle' | 'saving' | 'saved' | 'failed'>('idle');
	/** What Reset replaced, so it can be put back. */
	let undoTo = $state<Appearance | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** The last value sent, so the page data echoing it back does not overwrite newer edits. */
	let sentKey = '';

	// Page data refreshes as mail syncs; only a different saved value should replace the draft.
	let savedKey = '';
	$effect(() => {
		const key = JSON.stringify(saved);
		if (key === savedKey) return;
		savedKey = key;
		if (key === sentKey || timer) return;
		draft = { ...saved };
	});

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
		undoTo = null;
		applyAppearance(document.documentElement, draft);
		status = 'saving';
		clearTimeout(timer);
		timer = setTimeout(save, SAVE_DELAY_MS);
	}

	function reset() {
		const before = draft;
		update({ ...DEFAULT_APPEARANCE });
		undoTo = before;
	}

	function undo() {
		if (!undoTo) return;
		update(undoTo);
	}

	function chooseAccent(value: string) {
		const accent = parseAccent(value);
		// The first preset is the theme's own accent, so picking it stores nothing.
		update({ accent: accent === ACCENT_PRESETS[0] ? null : accent });
	}

	function send(keepalive = false) {
		sentKey = JSON.stringify(draft);
		return fetch('/api/settings/appearance', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ appearance: draft }),
			keepalive
		});
	}

	async function save() {
		timer = undefined;
		status = 'saving';
		try {
			const response = await send();
			if (!response.ok) throw new Error(String(response.status));
			// Other pages read the saved look from the layout data, so it must not go stale.
			await invalidateAll();
			if (!timer) status = 'saved';
		} catch {
			status = 'failed';
		}
	}

	// Leaving while a change waits to be saved sends it now, rather than dropping it.
	onDestroy(() => {
		if (!timer) return;
		clearTimeout(timer);
		void send(true);
	});
</script>

<section class="surface-lg card">
	<div class="head">
		<h2><Icon name="palette-line" size={18} /> {t('settings.personalise')}</h2>
		<span class="status" role="status">
			{#if status === 'saving'}
				{t('common.saving')}
			{:else if status === 'failed'}
				<span class="error">{t('settings.personaliseFailed')}</span>
				<button type="button" class="link" onclick={save}>{t('settings.personaliseRetry')}</button>
			{:else if undoTo}
				{t('settings.personaliseResetDone')}
				<button type="button" class="link" onclick={undo}>{t('settings.personaliseUndo')}</button>
			{:else if status === 'saved'}
				<Icon name="check-line" size={14} /> {t('common.saved')}
			{/if}
		</span>
		<button type="button" class="btn-ghost reset" disabled={isDefault} onclick={reset}>
			{t('settings.personaliseReset')}
		</button>
	</div>
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

	<h3 class="group-heading">{t('settings.customCss')}</h3>
	<p class="card-hint">
		{t('settings.customCssHint')}
		<a class="guide-link" href="/settings/css-guide">{t('settings.customCssGuide')}</a>
	</p>
	<div class="css-editor">
		<textarea
			value={draft.customCss}
			rows="8"
			spellcheck="false"
			autocapitalize="off"
			maxlength={MAX_CUSTOM_CSS}
			placeholder={'[data-ui-theme] .z-row-subject {\n\tfont-weight: 600;\n}'}
			aria-label={t('settings.customCss')}
			oninput={(event) => update({ customCss: event.currentTarget.value })}
		></textarea>
		<span class="css-count">{draft.customCss.length.toLocaleString()} / {MAX_CUSTOM_CSS.toLocaleString()}</span>
	</div>

	<fieldset class="group">
		<legend>{t('settings.themeShare')}</legend>
		<ThemeShare appearance={draft} onimport={(theme) => update(theme)} />
	</fieldset>

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

	.css-editor {
		position: relative;
		margin-top: 0.75rem;
	}

	.css-editor textarea {
		width: 100%;
		min-height: 10rem;
		padding: 0.75rem 0.875rem 1.75rem;
		border: none;
		border-radius: calc(0.625rem * var(--radius-scale, 1));
		background: var(--color-surface-muted);
		color: var(--color-text);
		font-family: var(--font-geist-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
		line-height: 1.55;
		tab-size: 2;
		resize: vertical;
	}

	.css-editor textarea::placeholder {
		color: var(--color-text-secondary);
	}

	.css-count {
		position: absolute;
		right: 0.75rem;
		bottom: 0.6rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
		pointer-events: none;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}

	.head h2 {
		margin-right: auto;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.guide-link {
		color: var(--color-accent-text);
		font-weight: 600;
		text-underline-offset: 2px;
	}

	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--color-accent-text);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
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
