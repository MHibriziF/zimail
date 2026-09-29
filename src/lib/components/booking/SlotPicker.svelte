<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import { addDays, dateKeyToUtc } from '$lib/calendar/events';
	import { dateKeyIn } from '$lib/calendar/grid';
	import { SLOT_DAYS_PER_REQUEST } from '$lib/calendar/reservations';
	import type { DaySlots } from '$lib/calendar/slots';

	/**
	 * A week of free slots at a time, shown in the guest's own dates and zone.
	 * Shared by the booking page and the page where a guest moves their booking.
	 */
	let {
		url,
		pageZone,
		endDate,
		guestZone,
		locale,
		chosen = $bindable('')
	}: {
		/** Returns `{ days }`; takes `?from=YYYY-MM-DD`. */
		url: string;
		/** The page's zone: which day "today" is, for paging back. */
		pageZone: string;
		/** The page's last bookable date. */
		endDate: string;
		guestZone: string;
		locale: string;
		chosen?: string;
	} = $props();

	const timeFormat = $derived(new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: guestZone }));
	const dayFormat = $derived(
		new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
	);

	let fromKey = $state<string | null>(null);
	let days = $state<DaySlots[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	/** The same free slots, regrouped by the guest's own dates. */
	const groups = $derived.by(() => {
		const byDay = new Map<string, string[]>();
		for (const slot of days.flatMap((day) => day.slots)) {
			const key = dateKeyIn(new Date(slot), guestZone);
			byDay.set(key, [...(byDay.get(key) ?? []), slot]);
		}
		return [...byDay.entries()].map(([key, slots]) => ({ key, slots }));
	});
	const firstDay = $derived(days[0]?.date ?? null);
	const lastDay = $derived(days.at(-1)?.date ?? null);
	const hasPrevious = $derived(fromKey !== null && firstDay !== null && firstDay > dateKeyIn(new Date(), pageZone));
	const hasNext = $derived(lastDay !== null && lastDay < endDate);

	let request = 0;
	$effect(() => {
		const current = ++request;
		const query = fromKey ? `?from=${fromKey}` : '';
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

	function shift(direction: 1 | -1) {
		const base = direction === 1 ? lastDay : firstDay;
		if (!base) return;
		chosen = '';
		fromKey = addDays(base, direction === 1 ? 1 : -SLOT_DAYS_PER_REQUEST);
	}

	/** Takes a slot out of the list — someone else got it first. */
	export function drop(slot: string) {
		days = days.map((day) => ({ ...day, slots: day.slots.filter((entry) => entry !== slot) }));
		if (chosen === slot) chosen = '';
	}
</script>

<div class="slot-week">
	<button type="button" class="icon-btn" aria-label={t('book.earlier')} disabled={!hasPrevious || loading} onclick={() => shift(-1)}>
		<Icon name="arrow-left-s-line" size={20} />
	</button>
	<span>
		{#if firstDay && lastDay}
			{dayFormat.format(dateKeyToUtc(firstDay)!)} – {dayFormat.format(dateKeyToUtc(lastDay)!)}
		{/if}
	</span>
	<button type="button" class="icon-btn" aria-label={t('book.later')} disabled={!hasNext || loading} onclick={() => shift(1)}>
		<Icon name="arrow-right-s-line" size={20} />
	</button>
</div>

{#if loadError}
	<p class="slot-error" role="alert">{loadError}</p>
{:else if !loading && groups.length === 0}
	<p class="slot-empty">{hasNext ? t('book.noneThisWeek') : t('book.noneLeft')}</p>
{/if}

<div class="slot-days" aria-busy={loading}>
	{#each groups as group (group.key)}
		<div class="slot-day">
			<h2>{dayFormat.format(dateKeyToUtc(group.key)!)}</h2>
			<div class="slot-grid">
				{#each group.slots as slot (slot)}
					<button type="button" class="slot" aria-pressed={chosen === slot} onclick={() => (chosen = slot)}>
						{timeFormat.format(new Date(slot))}
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.slot-week {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		text-align: center;
	}

	.slot-days {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.slot-days[aria-busy='true'] {
		opacity: 0.5;
	}

	.slot-day h2 {
		margin: 0 0 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.slot-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
		gap: 0.5rem;
	}

	.slot {
		padding: 0.5rem;
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
</style>
