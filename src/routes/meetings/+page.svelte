<script lang="ts">
	import MeetingsPage from '$lib/components/meet/MeetingsPage.svelte';
	import { t } from '$lib/i18n';
	import { APP_NAME } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{t('meetings.title', { app: APP_NAME })}</title></svelte:head>

<MeetingsPage meetings={data.meetings} />
