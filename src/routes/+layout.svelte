<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
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
	import { getTheme } from '$lib/ui-theme/registry';
	import MailboxLiveSync from '$lib/components/mailbox/MailboxLiveSync.svelte';
	import type { ThemeShellData } from '$lib/ui-theme/types';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// Onboarding runs before the user has an address, so the shell would be empty.
	// /meet is a call — even a signed-in host should see it full-screen, the way
	// a Gmeet link opens on its own rather than inside Gmail's chrome.
	const showShell = $derived(
		Boolean(data.user) &&
			$page.url.pathname !== '/onboarding' &&
			$page.url.pathname !== '/account/setup' &&
			!$page.url.pathname.startsWith('/meet/')
	);

	// The shell is the theme's — everything below it is the same routes either way.
	const ThemeShell = $derived(getTheme(data.uiTheme).Shell);
	const shellData = $derived.by((): ThemeShellData | null => {
		if (!data.user) return null;
		return {
			user: data.user,
			domains: data.domains,
			addresses: data.addresses,
			activeDomainId: data.activeDomainId,
			counts: data.counts,
			uiTheme: data.uiTheme
		};
	});

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

{#if showShell && shellData}
	<MailboxLiveSync />
	<ThemeShell data={shellData}>
		{@render children()}
	</ThemeShell>
{:else}
	{@render children()}
{/if}
