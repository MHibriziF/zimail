<script lang="ts">
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { readThemePreference, setThemePreference, THEME_OPTIONS, type ThemePreference } from '$lib/theme';

	// The preference lives in localStorage, so it can only be read on the client.
	let theme = $state<ThemePreference>('system');
	$effect(() => {
		theme = readThemePreference();
	});

	function chooseTheme(next: ThemePreference) {
		theme = next;
		setThemePreference(next);
	}
</script>

<section class="surface-lg card">
	<h2><Icon name="contrast-2-line" size={18} /> Appearance</h2>

	<div class="theme-options" role="radiogroup" aria-label={t('settings.theme')}>
		{#each THEME_OPTIONS as option (option.value)}
			<button
				type="button"
				role="radio"
				aria-checked={theme === option.value}
				class="theme-option"
				class:selected={theme === option.value}
				onclick={() => chooseTheme(option.value)}
			>
				<span class="theme-preview theme-preview-{option.value}">
					<span class="preview-bar"></span>
					<span class="preview-line"></span>
					<span class="preview-line short"></span>
				</span>
				<span class="theme-label">
					<Icon name={option.icon} size={15} />
					{option.label}
				</span>
				{#if theme === option.value}
					<span class="theme-check"><Icon name="check-line" size={14} /></span>
				{/if}
			</button>
		{/each}
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

	.theme-options {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.625rem;
		margin-top: 1rem;
	}

	.theme-option {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.625rem;
		border-radius: 0.875rem;
		text-align: left;
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: box-shadow 0.15s, background 0.15s;
	}

	.theme-option:hover {
		background: var(--color-surface-muted);
	}

	.theme-option.selected {
		box-shadow: inset 0 0 0 2px var(--color-accent);
	}

	/* A miniature of the app in that theme — fixed colours, not theme tokens. */
	.theme-preview {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.3125rem;
		height: 3.25rem;
		padding: 0.5rem;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.preview-bar {
		width: 60%;
		height: 0.375rem;
		border-radius: 9999px;
	}

	.preview-line {
		width: 100%;
		height: 0.25rem;
		border-radius: 9999px;
		opacity: 0.55;
	}

	.preview-line.short {
		width: 70%;
	}

	.theme-preview-light {
		background: #f5f5f5;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
	}

	.theme-preview-light .preview-bar,
	.theme-preview-light .preview-line {
		background: #0a0a0a;
	}

	.theme-preview-dark {
		background: #17171a;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
	}

	.theme-preview-dark .preview-bar,
	.theme-preview-dark .preview-line {
		background: #f4f4f5;
	}

	.theme-preview-system {
		background: linear-gradient(120deg, #f5f5f5 0 50%, #17171a 50% 100%);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.theme-preview-system .preview-bar,
	.theme-preview-system .preview-line {
		background: linear-gradient(120deg, #0a0a0a 0 50%, #f4f4f5 50% 100%);
	}

	.theme-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.theme-option.selected .theme-label {
		color: var(--color-text);
	}

	.theme-check {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 9999px;
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}

		.theme-options {
			gap: 0.5rem;
		}
	}
</style>
