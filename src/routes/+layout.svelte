<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/logo.png';
	import { watchSystemTheme } from '$lib/theme';
	import {
		captureInstallPrompt,
		isStandaloneDisplay,
		registerAppServiceWorker
	} from '$lib/app-chrome';
	import { setupMobileViewTransitions } from '$lib/view-transitions';
	import { persistUiTheme } from '$lib/ui-theme/apply';
	import { persistLocale } from '$lib/i18n';
	import NavigationProgress from '$lib/components/NavigationProgress.svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	setupMobileViewTransitions();

	// app.html already applied the colour scheme; this keeps "System" live afterwards.
	$effect(() => watchSystemTheme());

	// hooks.server.ts stamped the shell onto <html>; mirroring it into storage
	// keeps a hard reload from painting the wrong one.
	$effect(() => {
		if (data.user) persistUiTheme(data.uiTheme);
	});

	$effect(() => {
		persistLocale(data.locale);
	});

	$effect(() => {
		registerAppServiceWorker();
		captureInstallPrompt();
	});

	$effect(() => {
		const syncStandalone = () => {
			document.documentElement.dataset.standalone = isStandaloneDisplay() ? 'true' : 'false';
		};
		syncStandalone();
		const standalone = window.matchMedia('(display-mode: standalone)');
		const fullscreen = window.matchMedia('(display-mode: fullscreen)');
		standalone.addEventListener('change', syncStandalone);
		fullscreen.addEventListener('change', syncStandalone);
		return () => {
			standalone.removeEventListener('change', syncStandalone);
			fullscreen.removeEventListener('change', syncStandalone);
		};
	});
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={favicon} />
	{#if data.uiTheme === 'classic'}
		<link
			href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
			rel="stylesheet"
			media="(min-width: 901px)"
		/>
	{/if}
</svelte:head>

<NavigationProgress />

{@render children()}
