<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import { addDays, dateKeyToUtc } from '$lib/calendar/events';
	import { dateKeyIn } from '$lib/calendar/grid';
	import type { DaySlots } from '$lib/calendar/slots';
	import { listTimeZones } from '$lib/timezone';

	/**
	 * A month of free slots, picked date first and then time, in a zone the guest
	 * can change. Shared by the booking page and the page where a guest moves their booking.
	 */
	let {
		url,
		endDate,
		startDate = null,
		locale,
		guestZone = $bindable(),
		chosen = $bindable('')
	}: {
		/** Returns `{ days }`; takes `?from=YYYY-MM-DD&days=N`. */
		url: string;
		/** The page's last bookable date. */
		endDate: string;
		/** The page's first bookable date, so the calendar opens on a month with times in it. */
		startDate?: string | null;
		locale: string;
		/** Where times are shown; starts as the guest's detected zone. */
		guestZone: string;
		chosen?: string;
	} = $props();

	const zones = $derived(listTimeZones([guestZone]));
	const monthOf = (key: string) => key.slice(0, 7);
	const todayKey = $derived(dateKeyIn(new Date(), guestZone));
	const firstMonth = $derived(monthOf(todayKey));

	let month = $state('');
	let days = $state<DaySlots[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let selectedDay = $state('');
	let version = $state(0);

	$effect(() => {
		if (!month) month = [firstMonth, monthOf(startDate ?? '')].sort((a, b) => a.localeCompare(b))[1];
	});

	const monthStart = $derived(`${month}-01`);
	const daysInMonth = $derived.by(() => {
		if (!month) return 0;
		const [year, monthNumber] = month.split('-').map(Number);
		return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	});

	/** Free slots by the guest's own dates. */
	const byDay = $derived.by(() => {
		const grouped = new Map<string, string[]>();
		for (const slot of days.flatMap((day) => day.slots)) {
			const key = dateKeyIn(new Date(slot), guestZone);
			grouped.set(key, [...(grouped.get(key) ?? []), slot]);
		}
		return grouped;
	});

	/** The month as weeks of date keys, `null` for the blanks around it. Weeks start on Sunday. */
	const weeks = $derived.by(() => {
		if (!month) return [];
		const lead = dateKeyToUtc(monthStart)!.getUTCDay();
		const cells: (string | null)[] = [
			...Array.from({ length: lead }, () => null),
			...Array.from({ length: daysInMonth }, (_, index) => addDays(monthStart, index))
		];
		while (cells.length % 7) cells.push(null);
		return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
	});

	const monthLabel = $derived(
		month ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateKeyToUtc(monthStart)!) : ''
	);
	// 4 Oct 2026 is a Sunday, so index = weekday number.
	const weekdayLabels = $derived(
		Array.from({ length: 7 }, (_, day) =>
			new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(Date.UTC(2026, 9, 4 + day))
		)
	);
	const dayLabel = $derived(new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }));
	const timeFormat = $derived(new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: guestZone }));
	const hasPrevious = $derived(month > firstMonth);
	const hasNext = $derived(!!month && addDays(monthStart, daysInMonth) <= endDate);
	const selectedSlots = $derived(byDay.get(selectedDay) ?? []);

	let request = 0;
	$effect(() => {
		void version;
		if (!month) return;
		const current = ++request;
		// A day either side, so a zone far from the page's still gets the month's edges.
		const query = `?from=${addDays(monthStart, -1)}&days=${daysInMonth + 2}`;
		loading = true;
		loadError = '';
		fetch(`${url}${query}`)
			.then(async (response) => {
				const body = (await response.json().catch(() => ({}))) as { days?: DaySlots[]; error?: string };
				if (current !== request) return;
				if (!response.ok || !body.days) loadError = body.error ?? t('book.couldNotLoad');
				else days = body.days;
			})
			.catch(() => {
				if (current === request) loadError = t('common.networkError');
			})
			.finally(() => {
				if (current === request) loading = false;
			});
	});

	// Keep the picked day while it still has times; otherwise open on the first one that does.
	$effect(() => {
		if (loading || byDay.has(selectedDay)) return;
		selectedDay = [...byDay.keys()].filter((key) => monthOf(key) === month).sort((a, b) => a.localeCompare(b))[0] ?? '';
	});

	function shift(direction: 1 | -1) {
		chosen = '';
		selectedDay = '';
		days = [];
		month = monthOf(direction === 1 ? addDays(monthStart, daysInMonth) : addDays(monthStart, -1));
	}

	function pickDay(key: string) {
		if (selectedDay !== key) chosen = '';
		selectedDay = key;
	}

	/** Takes a slot out of the list — someone else got it first. */
	export function drop(slot: string) {
		days = days.map((day) => ({ ...day, slots: day.slots.filter((entry) => entry !== slot) }));
		if (chosen === slot) chosen = '';
	}

	/** Fetches the shown month again, so slots others booked meanwhile disappear. */
	export function reload() {
		version++;
	}
</script>

<div class="picker">
	<div class="cal">
		<div class="cal-head">
			<button type="button" class="icon-btn" aria-label={t('book.earlier')} disabled={!hasPrevious || loading} onclick={() => shift(-1)}>
				<Icon name="arrow-left-s-line" size={20} />
			</button>
			<span class="cal-month">{monthLabel}</span>
			<button type="button" class="icon-btn" aria-label={t('book.later')} disabled={!hasNext || loading} onclick={() => shift(1)}>
				<Icon name="arrow-right-s-line" size={20} />
			</button>
		</div>
		<div class="cal-grid" role="grid" aria-label={monthLabel} aria-busy={loading}>
			<div class="cal-row" role="row">
				{#each weekdayLabels as label, index (index)}<span class="cal-weekday" role="columnheader">{label}</span>{/each}
			</div>
			{#each weeks as week, row (row)}
				<div class="cal-row" role="row">
					{#each week as key, column (column)}
						{#if key}
							{@const open = byDay.has(key)}
							<button
								type="button"
								role="gridcell"
								class="cal-day"
								class:open
								class:today={key === todayKey}
								aria-selected={key === selectedDay}
								aria-label={dayLabel.format(dateKeyToUtc(key)!)}
								disabled={!open}
								onclick={() => pickDay(key)}
							>
								{Number(key.slice(8))}
							</button>
						{:else}
							<span class="cal-blank" role="gridcell"></span>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
		<label class="zone">
			<Icon name="global-line" size={15} />
			<span class="sr-only">{t('book.timeZone')}</span>
			<select bind:value={guestZone} aria-label={t('book.timeZone')}>
				{#each zones as zone (zone)}<option value={zone}>{zone.replaceAll('_', ' ')}</option>{/each}
			</select>
		</label>
	</div>

	<div class="times">
		{#if loadError}
			<p class="slot-error" role="alert">{loadError}</p>
		{:else if loading}
			<p class="slot-empty">{t('common.loading')}</p>
		{:else if !selectedDay}
			<p class="slot-empty">{hasNext ? t('book.noneThisMonth') : t('book.noneLeft')}</p>
		{:else}
			<h2>{dayLabel.format(dateKeyToUtc(selectedDay)!)}</h2>
			<div class="slot-list">
				{#each selectedSlots as slot (slot)}
					<button type="button" class="slot" aria-pressed={chosen === slot} onclick={() => (chosen = slot)}>
						{timeFormat.format(new Date(slot))}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.picker {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 13rem);
		gap: 1.5rem;
	}

	@media (max-width: 36rem) {
		.picker {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.cal {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.cal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.cal-month {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.cal-grid {
		display: grid;
		gap: 0.25rem;
	}

	.cal-grid[aria-busy='true'] {
		opacity: 0.5;
	}

	.cal-row {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0.25rem;
	}

	.cal-weekday {
		padding-bottom: 0.25rem;
		font-size: 0.75rem;
		font-weight: 500;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.cal-day {
		aspect-ratio: 1;
		max-height: 2.75rem;
		border-radius: 999px;
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-muted);
	}

	.cal-day.open {
		font-weight: 600;
		color: var(--color-accent-text);
		background: var(--color-accent-soft, color-mix(in srgb, var(--color-accent) 14%, transparent));
	}

	.cal-day.open:hover {
		background: color-mix(in srgb, var(--color-accent) 24%, transparent);
	}

	.cal-day[aria-selected='true'] {
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.cal-day.today:not([aria-selected='true']) {
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.cal-day:disabled {
		cursor: default;
	}

	.zone {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.zone select {
		min-width: 0;
		max-width: 100%;
		padding: 0.25rem 0.375rem;
		border-radius: 0.5rem;
		font: inherit;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.times {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.times h2 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.slot-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 20rem;
		overflow-y: auto;
	}

	@media (max-width: 36rem) {
		.slot-list {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
			max-height: none;
		}
	}

	.slot {
		padding: 0.625rem 0.5rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		color: var(--color-accent-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-accent);
	}

	.slot:hover,
	.slot[aria-pressed='true'] {
		color: var(--color-on-accent);
		background: var(--color-accent);
	}

	.slot-error {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.slot-empty {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
