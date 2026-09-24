<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import { detectTimeZone } from '$lib/timezone';
	import { addDays, type CalendarEvent } from '$lib/calendar/events';
	import { dateKeyIn, eventDateKeys } from '$lib/calendar/grid';

	/** Shared by both themes' sidebars, so it styles itself from the `--color-*` tokens both define. */
	let { events }: { events: CalendarEvent[] } = $props();

	const MAX_SHOWN = 4;

	const timeZone = $derived<string>($page.data.timeZone ?? (browser ? detectTimeZone() : 'UTC'));
	const timeFormat = $derived(
		new Intl.DateTimeFormat(intlLocale($page.data.locale ?? DEFAULT_LOCALE), {
			hour: 'numeric',
			minute: '2-digit',
			timeZone
		})
	);

	const rows = $derived.by(() => {
		const now = new Date();
		const today = dateKeyIn(now, timeZone);
		const tomorrow = addDays(today, 1);
		return events
			.filter((event) => event.allDay || new Date(event.end) > now)
			.map((event) => {
				const days = eventDateKeys(event, timeZone);
				const day = days.includes(today) ? today : days[0];
				return { event, day };
			})
			.filter(({ day }) => day === today || day === tomorrow)
			.slice(0, MAX_SHOWN)
			.map(({ event, day }) => ({
				event,
				when: [
					day === today ? t('calendar.today') : t('calendar.tomorrow'),
					event.allDay ? t('calendar.allDay') : timeFormat.format(new Date(event.start))
				].join(' · ')
			}));
	});
</script>

{#if rows.length > 0}
	<ul class="upcoming" aria-label={t('calendar.comingUp')}>
		{#each rows as row (row.event.id)}
			<li>
				<a href="/calendar" class="upcoming-row">
					<span class="upcoming-title">{row.event.title}</span>
					<span class="upcoming-when">{row.when}</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.upcoming {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.upcoming-row {
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
		padding: 0.375rem 0.625rem;
		border-left: 2px solid var(--color-accent);
		border-radius: 0 0.5rem 0.5rem 0;
		text-decoration: none;
		color: var(--color-text);
	}

	.upcoming-row:hover {
		background: var(--color-surface-hover);
	}

	.upcoming-title {
		font-size: 0.8125rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.upcoming-when {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}
</style>
