<script lang="ts">
	import CalendarPage from '$lib/components/calendar/CalendarPage.svelte';
	import { t } from '$lib/i18n';
	import { APP_NAME } from '$lib/constants';
</script>

<svelte:head><title>{t('calendar.title', { app: APP_NAME })}</title></svelte:head>

<CalendarPage />
