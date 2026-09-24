<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import { detectTimeZone } from '$lib/timezone';
	import StackHeader from '../StackHeader.svelte';
	import Icon from '../Icon.svelte';
	import EventEditor from './EventEditor.svelte';
	import CalendarFeeds from './CalendarFeeds.svelte';
	import ReservationPages from './ReservationPages.svelte';
	import { LABEL_SWATCH } from '$lib/mail/labels';
	import { addDays, dateKeyToUtc, isDeletableEvent, isReadOnlyEvent, type CalendarEvent } from '$lib/calendar/events';
	import {
		dateKeyIn,
		firstDayOfWeek,
		formatMonthParam,
		groupByDay,
		monthGrid,
		parseMonthParam,
		shiftMonth,
		startOfDayIn,
		type YearMonth
	} from '$lib/calendar/grid';
	import { draftForNew, draftFromEvent, draftToInput, type EventDraft } from '$lib/calendar/editor';
	import { deleteEvent, fetchEvents, saveEvent } from '$lib/calendar/client';

	type Editing = { event: CalendarEvent | null; draft: EventDraft };

	const MAX_CHIPS = 3;

	const locale = $derived(intlLocale($page.data.locale ?? DEFAULT_LOCALE));
	// A saved zone wins; otherwise the browser's. The server can't know the latter,
	// which is why events load after mount rather than in a server load.
	const timeZone = $derived<string>($page.data.timeZone ?? (browser ? detectTimeZone() : 'UTC'));
	const weekStart = $derived(firstDayOfWeek(locale));
	const today = $derived(dateKeyIn(new Date(), timeZone));

	const todayMonth = (): YearMonth => {
		const [year, month] = today.split('-').map(Number);
		return { year, month };
	};

	let month = $state<YearMonth>(untrack(() => parseMonthParam($page.url.searchParams.get('month'), todayMonth())));
	let view = $state<'month' | 'agenda'>('month');
	let selected = $state('');
	let events = $state<CalendarEvent[]>([]);
	let loading = $state(false);
	let loadError = $state('');
	let editing = $state<Editing | null>(null);
	let saving = $state(false);
	let saveError = $state('');

	const grid = $derived(monthGrid(month, weekStart));
	const byDay = $derived(groupByDay(events, timeZone));
	const monthPrefix = $derived(formatMonthParam(month));
	// Until a day is picked: today in the current month, else the 1st of the one shown.
	const selectedDay = $derived(selected || (today.startsWith(monthPrefix) ? today : `${monthPrefix}-01`));
	const agendaDays = $derived(
		grid.filter((key) => key.startsWith(monthPrefix) && key >= (monthPrefix === today.slice(0, 7) ? today : ''))
	);

	const utcFormat = (options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
	const monthLabel = $derived(utcFormat({ month: 'long', year: 'numeric' }).format(Date.UTC(month.year, month.month - 1, 1)));
	const weekdayLabels = $derived(grid.slice(0, 7).map((key) => utcFormat({ weekday: 'short' }).format(dateKeyToUtc(key)!)));
	const dayHeading = $derived(utcFormat({ weekday: 'long', month: 'long', day: 'numeric' }));
	const timeFormat = $derived(new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }));

	let request = 0;
	async function load() {
		const current = ++request;
		loading = true;
		loadError = '';
		try {
			const from = startOfDayIn(grid[0], timeZone);
			const to = startOfDayIn(addDays(grid[grid.length - 1], 1), timeZone);
			const loaded = await fetchEvents(from, to, timeZone);
			if (current === request) events = loaded;
		} catch (failure) {
			if (current === request) loadError = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			if (current === request) loading = false;
		}
	}

	// Re-runs whenever the grid or zone changes; both are read before load's first await.
	$effect(() => {
		load();
	});

	function goMonth(delta: number) {
		month = delta === 0 ? todayMonth() : shiftMonth(month, delta);
		selected = '';
		const url = new URL(window.location.href);
		url.searchParams.set('month', formatMonthParam(month));
		history.replaceState(history.state, '', url);
	}

	function eventTime(event: CalendarEvent, dayKey: string): string {
		if (event.allDay) return t('calendar.allDay');
		const starts = dateKeyIn(new Date(event.start), timeZone);
		if (starts !== dayKey) return t('calendar.continues');
		return `${timeFormat.format(new Date(event.start))} – ${timeFormat.format(new Date(event.end))}`;
	}

	/** Feed events wear their calendar's color; others the accent. */
	function eventColor(event: CalendarEvent): string {
		return event.calendar ? LABEL_SWATCH[event.calendar.color] : 'var(--color-accent)';
	}

	function openNew(dayKey: string) {
		saveError = '';
		editing = { event: null, draft: draftForNew(dayKey, timeZone) };
	}

	function openEvent(event: CalendarEvent) {
		saveError = '';
		editing = { event, draft: draftFromEvent(event, timeZone) };
	}

	async function afterWrite() {
		editing = null;
		await Promise.all([load(), invalidate('app:calendar')]);
	}

	async function save(draft: EventDraft) {
		if (!editing || saving) return;
		saving = true;
		saveError = '';
		try {
			await saveEvent(draftToInput(draft, timeZone), editing.event?.id);
			await afterWrite();
		} catch (failure) {
			saveError = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			saving = false;
		}
	}

	async function remove() {
		const id = editing?.event?.id;
		if (!id || saving) return;
		saving = true;
		saveError = '';
		try {
			await deleteEvent(id);
			await afterWrite();
		} catch (failure) {
			saveError = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			saving = false;
		}
	}
</script>

{#snippet eventRow(event: CalendarEvent, dayKey: string)}
	<li>
		<button
			type="button"
			class="cal-row"
			class:free={!event.busy}
			style="--event-color: {eventColor(event)}"
			onclick={() => openEvent(event)}
		>
			<span class="cal-row-time">{eventTime(event, dayKey)}</span>
			<span class="cal-row-title">{event.title}</span>
			{#if event.location}
				<span class="cal-row-meta"><Icon name="map-pin-line" size={13} />{event.location}</span>
			{/if}
			{#if event.calendar}
				<span class="cal-row-meta"><Icon name="calendar-line" size={13} />{event.calendar.name}</span>
			{/if}
		</button>
	</li>
{/snippet}

<div class="cal-page">
	<StackHeader title={t('calendar.heading')} back={false} />

	<div class="cal-toolbar">
		<div class="cal-nav">
			<button type="button" class="icon-btn" aria-label={t('calendar.previousMonth')} onclick={() => goMonth(-1)}>
				<Icon name="arrow-left-s-line" size={18} />
			</button>
			<button type="button" class="cal-today" onclick={() => goMonth(0)}>{t('calendar.today')}</button>
			<button type="button" class="icon-btn" aria-label={t('calendar.nextMonth')} onclick={() => goMonth(1)}>
				<Icon name="arrow-right-s-line" size={18} />
			</button>
			<h2 class="cal-month" aria-live="polite">{monthLabel}</h2>
			{#if loading}<span class="cal-loading" aria-hidden="true"></span>{/if}
		</div>
		<div class="cal-nav">
			<div class="cal-views" role="tablist">
				<button type="button" role="tab" aria-selected={view === 'month'} onclick={() => (view = 'month')}>
					{t('calendar.monthView')}
				</button>
				<button type="button" role="tab" aria-selected={view === 'agenda'} onclick={() => (view = 'agenda')}>
					{t('calendar.agendaView')}
				</button>
			</div>
			<button type="button" class="btn-primary" onclick={() => openNew(selectedDay)}>
				<Icon name="add-line" size={16} />
				{t('calendar.newEvent')}
			</button>
		</div>
	</div>

	{#if loadError}<p class="cal-error" role="alert">{loadError}</p>{/if}

	{#if view === 'month'}
		<div class="cal-grid surface-lg">
			{#each weekdayLabels as label, index (index)}
				<div class="cal-weekday" aria-hidden="true">{label}</div>
			{/each}
			{#each grid as key (key)}
				{@const dayEvents = byDay.get(key) ?? []}
				<div
					class="cal-day"
					class:outside={!key.startsWith(monthPrefix)}
					class:today={key === today}
					class:selected={key === selectedDay}
				>
					<button
						type="button"
						class="cal-day-hit"
						aria-label={dayHeading.format(dateKeyToUtc(key)!)}
						aria-pressed={key === selectedDay}
						onclick={() => (selected = key)}
						ondblclick={() => openNew(key)}
					></button>
					<span class="cal-day-num">{Number(key.slice(8))}</span>
					<ul class="cal-chips">
						{#each dayEvents.slice(0, MAX_CHIPS) as event (event.id)}
							<li>
								<button
									type="button"
									class="cal-chip"
									class:allday={event.allDay}
									class:free={!event.busy}
									style="--event-color: {eventColor(event)}"
									title={event.calendar ? `${event.title} · ${event.calendar.name}` : event.title}
									onclick={() => openEvent(event)}
								>
									{#if !event.allDay && dateKeyIn(new Date(event.start), timeZone) === key}
										<span class="cal-chip-time">{timeFormat.format(new Date(event.start))}</span>
									{/if}
									<span class="cal-chip-title">{event.title}</span>
								</button>
							</li>
						{/each}
					</ul>
					{#if dayEvents.length > MAX_CHIPS}
						<span class="cal-more">{t('calendar.more', { count: dayEvents.length - MAX_CHIPS })}</span>
					{/if}
					{#if dayEvents.length > 0}<span class="cal-dot" aria-hidden="true"></span>{/if}
				</div>
			{/each}
		</div>

		<section class="cal-day-panel surface-lg">
			<header class="cal-day-panel-head">
				<h3>{dayHeading.format(dateKeyToUtc(selectedDay)!)}</h3>
				<button type="button" class="icon-btn" aria-label={t('calendar.newEvent')} onclick={() => openNew(selectedDay)}>
					<Icon name="add-line" size={18} />
				</button>
			</header>
			{#if (byDay.get(selectedDay) ?? []).length === 0}
				<p class="cal-empty">{t('calendar.nothingThisDay')}</p>
			{:else}
				<ul class="cal-rows">
					{#each byDay.get(selectedDay) ?? [] as event (event.id)}
						{@render eventRow(event, selectedDay)}
					{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<section class="cal-agenda surface-lg">
			{#each agendaDays.filter((key) => byDay.has(key)) as key (key)}
				<div class="cal-agenda-day">
					<h3 class:today={key === today}>{dayHeading.format(dateKeyToUtc(key)!)}</h3>
					<ul class="cal-rows">
						{#each byDay.get(key) ?? [] as event (event.id)}
							{@render eventRow(event, key)}
						{/each}
					</ul>
				</div>
			{:else}
				<p class="cal-empty">{t('calendar.nothingThisMonth')}</p>
			{/each}
		</section>
	{/if}

	<ReservationPages />

	<CalendarFeeds
		onchange={() => {
			load();
			invalidate('app:calendar');
		}}
	/>
</div>

{#if editing}
	<EventEditor
		initial={editing.draft}
		isNew={!editing.event}
		readOnly={editing.event ? isReadOnlyEvent(editing.event) : false}
		deletable={editing.event ? isDeletableEvent(editing.event) : false}
		busy={saving}
		error={saveError}
		onsave={save}
		ondelete={remove}
		oncancel={() => (editing = null)}
	/>
{/if}

<style>
	.cal-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 64rem;
	}

	.cal-page :global(.stack-header) {
		margin-bottom: 0;
	}

	.cal-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.cal-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.cal-month {
		margin: 0 0 0 0.25rem;
		font-size: 1.0625rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.cal-today,
	.cal-views button {
		padding: 0.375rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-focus-line);
	}

	.cal-views {
		display: flex;
		gap: 0.25rem;
	}

	.cal-views button[aria-selected='true'] {
		color: var(--color-accent-text);
		background: var(--color-accent-soft);
		box-shadow: none;
	}

	.cal-loading {
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		border: 2px solid var(--color-line);
		border-top-color: var(--color-accent);
		animation: cal-spin 0.8s linear infinite;
	}

	@keyframes cal-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.cal-error {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		overflow: hidden;
	}

	.cal-weekday {
		padding: 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		text-align: center;
		color: var(--color-text-secondary);
		box-shadow: inset 0 -1px 0 var(--color-line);
	}

	.cal-day {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-height: 6.5rem;
		padding: 0.25rem;
		box-shadow:
			inset -1px 0 0 var(--color-line),
			inset 0 -1px 0 var(--color-line);
	}

	.cal-day.outside {
		background: var(--color-surface-muted);
	}

	.cal-day.outside .cal-day-num {
		color: var(--color-muted);
	}

	.cal-day.selected {
		box-shadow:
			inset 0 0 0 2px var(--color-accent),
			inset -1px 0 0 var(--color-line);
	}

	.cal-day-hit {
		position: absolute;
		inset: 0;
		background: transparent;
	}

	.cal-day-num {
		position: relative;
		align-self: flex-start;
		min-width: 1.5rem;
		padding: 0.125rem 0.375rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		text-align: center;
		pointer-events: none;
	}

	.cal-day.today .cal-day-num {
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.cal-chips {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
		pointer-events: none;
	}

	.cal-chip {
		display: flex;
		gap: 0.25rem;
		width: 100%;
		padding: 0.0625rem 0.375rem;
		border-radius: 0.375rem;
		font-size: 0.6875rem;
		line-height: 1.4;
		text-align: left;
		color: var(--color-text);
		background: transparent;
		pointer-events: auto;
		overflow: hidden;
	}

	.cal-chip:hover {
		background: var(--color-surface-hover);
	}

	.cal-chip,
	.cal-row {
		box-shadow: inset 3px 0 0 var(--event-color);
	}

	/* Free time (a feed's TRANSP:TRANSPARENT) is shown but doesn't block reservations. */
	.cal-chip.free,
	.cal-row.free {
		box-shadow: inset 3px 0 0 color-mix(in srgb, var(--event-color) 45%, transparent);
		opacity: 0.7;
	}

	.cal-chip.allday {
		color: var(--color-text);
		background: color-mix(in srgb, var(--event-color) 18%, transparent);
	}


	.cal-chip-time {
		flex-shrink: 0;
		color: var(--color-text-secondary);
	}

	.cal-chip-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cal-more {
		position: relative;
		padding: 0 0.375rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		pointer-events: none;
	}

	.cal-dot {
		display: none;
	}

	.cal-day-panel,
	.cal-agenda {
		padding: 1rem 1.25rem;
	}

	.cal-day-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	h3.today {
		color: var(--color-accent-text);
	}

	.cal-agenda {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.cal-rows {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.cal-row {
		display: grid;
		grid-template-columns: 11rem minmax(0, 1fr);
		column-gap: 0.75rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		text-align: left;
		color: var(--color-text);
		background: transparent;
	}

	.cal-row:hover {
		background: var(--color-surface-hover);
	}


	.cal-row-time {
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.cal-row-title {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cal-row-meta {
		grid-column: 2;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.cal-empty {
		margin: 0.5rem 0 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	@media (max-width: 640px) {
		.cal-day {
			min-height: 3.25rem;
			align-items: center;
		}

		.cal-day-num {
			align-self: center;
		}

		.cal-chips,
		.cal-more {
			display: none;
		}

		.cal-dot {
			position: relative;
			display: block;
			width: 0.3125rem;
			height: 0.3125rem;
			border-radius: 50%;
			background: var(--color-accent);
			pointer-events: none;
		}

		.cal-row {
			grid-template-columns: minmax(0, 1fr);
		}

		.cal-row-meta {
			grid-column: 1;
		}
	}
</style>
