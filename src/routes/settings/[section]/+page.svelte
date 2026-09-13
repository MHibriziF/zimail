<script lang="ts">
	import SettingsPage from '$lib/components/settings/SettingsPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<SettingsPage {data} section={data.section} />
