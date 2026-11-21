<script lang="ts">
	import { getTheme } from '$lib/ui-theme/registry';
	import MailboxLiveSync from '$lib/components/mailbox/MailboxLiveSync.svelte';
	import SendToast from '$lib/components/mailbox/SendToast.svelte';
	import type { ThemeShellData } from '$lib/ui-theme/types';
	import type { LayoutData } from './$types';

	/**
	 * The signed-in app. Its pages live in this group so that the shell, and the
	 * composer every shell carries, are only downloaded by pages that show them:
	 * sign-in, onboarding, calls and booking pages sit outside it.
	 */
	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	// The shell is the theme's; everything below it is the same routes either way.
	const ThemeShell = $derived(getTheme(data.uiTheme).Shell);
	const shellData = $derived.by((): ThemeShellData | null => {
		if (!data.user) return null;
		return {
			user: data.user,
			domains: data.domains,
			addresses: data.addresses,
			activeDomainId: data.activeDomainId,
			counts: data.counts,
			labels: data.labels,
			upcoming: data.upcoming,
			uiTheme: data.uiTheme
		};
	});
</script>

{#if shellData}
	<MailboxLiveSync />
	<ThemeShell data={shellData}>
		{@render children()}
	</ThemeShell>
	<SendToast />
{:else}
	{@render children()}
{/if}
