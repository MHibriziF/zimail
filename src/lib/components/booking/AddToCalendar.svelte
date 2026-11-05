<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import { googleCalendarLink, outlookCalendarLink, type CalendarLinkEvent } from '$lib/calendar/add-to-calendar';

	/** For guests whose mail doesn't put the invitation on a calendar by itself. */
	let { event, icsUrl = null }: { event: CalendarLinkEvent; icsUrl?: string | null } = $props();
</script>

<div class="add-cal">
	<span class="add-cal-label">{t('book.addToCalendar')}</span>
	<div class="add-cal-links">
		<a class="add-cal-link" href={googleCalendarLink(event)} target="_blank" rel="noopener noreferrer">
			<Icon name="google-line" size={15} />Google
		</a>
		<a class="add-cal-link" href={outlookCalendarLink(event)} target="_blank" rel="noopener noreferrer">
			<Icon name="microsoft-line" size={15} />Outlook
		</a>
		{#if icsUrl}
			<a class="add-cal-link" href={icsUrl} download>
				<Icon name="calendar-event-line" size={15} />{t('book.downloadIcs')}
			</a>
		{/if}
	</div>
</div>

<style>
	.add-cal {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.add-cal-label {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.add-cal-links {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.add-cal-link {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4rem 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: 999px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		text-decoration: none;
	}

	.add-cal-link:hover {
		background: var(--color-surface-muted);
	}
</style>
