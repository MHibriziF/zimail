<script lang="ts">
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import Icon from '../Icon.svelte';
	import StackHeader from '../StackHeader.svelte';
	import { t } from '$lib/i18n';
	import { applyAppearance, parseAppearance } from '$lib/ui-theme/appearance';
	import {
		addExample,
		GUIDE_ATTRIBUTES,
		GUIDE_CLASSES,
		GUIDE_EXAMPLES,
		GUIDE_PARTS,
		GUIDE_VARIABLES
	} from '$lib/ui-theme/css-guide';

	const theme = $derived((($page.data.uiTheme as string | undefined) ?? 'zero') as 'zero' | 'classic');

	/** Values as this page has them, so they already include the reader's own palette. */
	let current = $state<Record<string, string>>({});
	$effect(() => {
		const styles = getComputedStyle(document.documentElement);
		// Unset means the CSS fallback, which for the radius scale is 1.
		current = Object.fromEntries(
			GUIDE_VARIABLES.map((v) => [v.name, styles.getPropertyValue(v.name).trim() || (v.name === '--radius-scale' ? '1' : '')])
		);
	});

	const isColour = (value: string) => /^(#|rgb|hsl|oklch|color-mix)/.test(value);

	/** `before` is the CSS from before an add, so the add can be undone from its own example. */
	let notice = $state<{ id: string; text: string; failed?: boolean; before?: string } | null>(null);

	async function copy(id: string, css: string) {
		try {
			await navigator.clipboard.writeText(css);
			notice = { id, text: t('cssGuide.copied') };
		} catch {
			notice = { id, text: t('cssGuide.addFailed'), failed: true };
		}
	}

	/** Saves custom CSS through the same route Personalise uses, and shows it at once. */
	async function saveCss(customCss: string) {
		const next = { ...parseAppearance($page.data.appearance), customCss };
		const response = await fetch('/api/settings/appearance', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ appearance: next })
		});
		if (!response.ok) throw new Error(String(response.status));
		applyAppearance(document.documentElement, next);
		await invalidateAll();
	}

	async function add(id: string, css: string) {
		const before = parseAppearance($page.data.appearance).customCss;
		try {
			await saveCss(addExample(before, css));
			notice = { id, text: t('cssGuide.added'), before };
		} catch {
			notice = { id, text: t('cssGuide.addFailed'), failed: true };
		}
	}

	async function undoAdd(id: string, before: string) {
		try {
			await saveCss(before);
			notice = { id, text: t('cssGuide.removed') };
		} catch {
			notice = { id, text: t('cssGuide.addFailed'), failed: true };
		}
	}
</script>

<svelte:head>
	<title>{t('cssGuide.title')}</title>
</svelte:head>

<div class="settings-page guide">
	<StackHeader title={t('cssGuide.title')} backHref="/settings/appearance" />

	<a class="back" href="/settings/appearance">
		<Icon name="arrow-left-line" size={16} />
		{t('cssGuide.back')}
	</a>

	<p class="lede">{t('cssGuide.intro')}</p>

	<section>
		<h2>{t('cssGuide.howTitle')}</h2>
		<ol class="how">
			<li>{t('cssGuide.how1')}</li>
			<li>{t('cssGuide.how2')}</li>
			<li>{t('cssGuide.how3')}</li>
			<li>{t('cssGuide.how4')}</li>
		</ol>
	</section>

	<section>
		<h2>{t('cssGuide.examplesTitle')}</h2>
		<p class="hint">{t('cssGuide.examplesHint')}</p>
		{#each GUIDE_EXAMPLES as example (example.id)}
			<article class="example">
				<h3>{t(`cssGuide.ex_${example.id}`)}</h3>
				<p class="hint">{t(`cssGuide.ex_${example.id}_desc`)}</p>
				<pre><code>{example.css}</code></pre>
				<div class="example-actions">
					<button type="button" class="btn-ghost" onclick={() => copy(example.id, example.css)}>
						<Icon name="file-copy-line" size={15} />
						{t('cssGuide.copy')}
					</button>
					<button type="button" class="btn-ghost" onclick={() => add(example.id, example.css)}>
						<Icon name="add-line" size={15} />
						{t('cssGuide.add')}
					</button>
					{#if notice?.id === example.id}
						<span class="notice" class:failed={notice.failed} role="status"
							>{notice.text}
							{#if notice.before !== undefined}
								{@const before = notice.before}
								<button type="button" class="undo" onclick={() => undoAdd(example.id, before)}>{t('settings.personaliseUndo')}</button>
							{/if}</span
						>
					{/if}
				</div>
			</article>
		{/each}
	</section>

	<section>
		<h2>{t('cssGuide.varsTitle')}</h2>
		<p class="hint">{t('cssGuide.varsHint')}</p>
		<table>
			<thead>
				<tr>
					<th scope="col">{t('cssGuide.colName')}</th>
					<th scope="col">{t('cssGuide.colWhat')}</th>
					<th scope="col">{t('cssGuide.colNow')}</th>
				</tr>
			</thead>
			<tbody>
				{#each GUIDE_VARIABLES.filter((v) => !v.only || v.only === theme) as variable (variable.name)}
					{@const value = current[variable.name] ?? ''}
					<tr>
						<td><code>{variable.name}</code></td>
						<td>{t(`cssGuide.var_${variable.key}`)}</td>
						<td class="now">
							{#if isColour(value)}<span class="chip" style:background={value}></span>{/if}
							<code>{value || '—'}</code>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section>
		<h2>{t('cssGuide.partsTitle')}</h2>
		<p class="hint">{t('cssGuide.partsHint')}</p>
		<ul class="defs">
			{#each GUIDE_PARTS as part (part.name)}
				<li><code>[data-part='{part.name}']</code> <span>{t(`cssGuide.part_${part.key}`)}</span></li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>{t('cssGuide.attrsTitle')}</h2>
		<p class="hint">{t('cssGuide.attrsHint')}</p>
		<ul class="defs">
			{#each GUIDE_ATTRIBUTES as attribute (attribute.name)}
				<li>
					<code>{attribute.name}</code>
					<span class="values">
						{#each attribute.values as value (value)}<code>{value}</code>{/each}
					</span>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>{t('cssGuide.classesTitle')}</h2>
		<p class="hint">{t('cssGuide.classesHint')}</p>
		<p class="values wrap">
			{#each GUIDE_CLASSES[theme] as name (name)}<code>{name}</code>{/each}
		</p>
	</section>
</div>

<style>
	.guide {
		max-width: 46rem;
		padding-bottom: 3rem;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.875rem;
		color: var(--color-accent-text);
		text-decoration: none;
	}

	.back:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.lede {
		margin-top: 1rem;
		max-width: 65ch;
		font-size: 0.9375rem;
		line-height: 1.6;
		color: var(--color-text);
	}

	section {
		margin-top: 2.25rem;
	}

	h2 {
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--color-text);
	}

	h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.hint {
		margin-top: 0.35rem;
		max-width: 65ch;
		font-size: 0.8125rem;
		line-height: 1.55;
		color: var(--color-text-secondary);
	}

	.how {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding-left: 1.25rem;
		max-width: 65ch;
		font-size: 0.875rem;
		line-height: 1.55;
		color: var(--color-text);
	}

	.example {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--color-line);
	}

	pre {
		margin-top: 0.75rem;
		padding: 0.875rem 1rem;
		overflow-x: auto;
		border-radius: calc(0.625rem * var(--radius-scale, 1));
		background: var(--color-surface-muted);
		font-size: 0.8125rem;
		line-height: 1.55;
	}

	code {
		font-family: var(--font-geist-mono, ui-monospace, monospace);
		font-size: 0.8125rem;
	}

	.example-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.625rem;
	}

	.example-actions .btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.notice {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
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

	.notice.failed {
		color: var(--color-danger);
	}

	table {
		width: 100%;
		margin-top: 0.75rem;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	th {
		padding: 0.5rem 0.5rem 0.5rem 0;
		border-bottom: 1px solid var(--color-line);
		font-weight: 600;
		text-align: left;
		color: var(--color-text-secondary);
	}

	td {
		padding: 0.55rem 0.5rem 0.55rem 0;
		border-bottom: 1px solid var(--color-line);
		vertical-align: top;
		color: var(--color-text);
	}

	.now {
		white-space: nowrap;
	}

	.chip {
		display: inline-block;
		width: 0.875rem;
		height: 0.875rem;
		margin-right: 0.35rem;
		border-radius: calc(0.25rem * var(--radius-scale, 1));
		box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.4);
		vertical-align: -0.125rem;
	}

	.defs {
		display: grid;
		gap: 0.5rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.defs li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
	}

	.values {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.values.wrap {
		margin-top: 0.75rem;
	}

	.values code,
	.defs > li > code {
		padding: 0.1rem 0.4rem;
		border-radius: calc(0.375rem * var(--radius-scale, 1));
		background: var(--color-surface-muted);
	}

	@media (max-width: 900px) {
		table thead {
			display: none;
		}

		table,
		tbody,
		tr,
		td {
			display: block;
		}

		tr {
			padding: 0.5rem 0;
			border-bottom: 1px solid var(--color-line);
		}

		td {
			padding: 0.1rem 0;
			border: none;
		}
	}
</style>
