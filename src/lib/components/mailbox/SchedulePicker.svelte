<script lang="ts">
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { MAX_SCHEDULE_YEARS } from '$lib/constants';
	import {
		detectTimeZone,
		fromLocalInputValue,
		toLocalInputValue,
		zonedHour,
		zonedWeekday
	} from '$lib/timezone';

	let {
		open = $bindable(false),
		timeZone = null,
		onpick
	}: {
		open: boolean;
		/** The saved preference; falls back to whatever this browser reports. */
		timeZone?: string | null;
		onpick: (isoTime: string) => void;
	} = $props();

	const zone = $derived(timeZone || detectTimeZone());

	/** Days until the next Monday in that zone; 7 if it is already Monday. */
	function daysUntilMonday(): number {
		return (8 - zonedWeekday(zone)) % 7 || 7;
	}

	const presets = $derived.by(() => {
		const now = Date.now();
		const options: Array<{ label: string; when: Date }> = [];
		// Only worth offering while there is still a useful gap.
		const later = (label: string, when: Date) => {
			if (when.getTime() - now > 60 * 60 * 1000) options.push({ label, when });
		};

		later(t('schedule.thisAfternoon'), zonedHour(zone, 0, 13));
		later(t('schedule.thisEvening'), zonedHour(zone, 0, 18));
		options.push({ label: t('schedule.tomorrowMorning'), when: zonedHour(zone, 1, 8) });
		options.push({ label: t('schedule.tomorrowAfternoon'), when: zonedHour(zone, 1, 13) });
		options.push({ label: t('schedule.mondayMorning'), when: zonedHour(zone, daysUntilMonday(), 8) });

		return options;
	});

	const dayFormat = $derived(
		new Intl.DateTimeFormat(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit',
			timeZone: zone
		})
	);

	let custom = $state('');
	let error = $state('');

	const customMin = $derived(toLocalInputValue(new Date(Date.now() + 60_000), zone));
	/**
	 * Not a delivery limit — the message waits here, not at the provider. It is
	 * only far enough out that a mistyped year is caught by the field itself.
	 */
	const customMax = $derived(
		toLocalInputValue(new Date(Date.now() + MAX_SCHEDULE_YEARS * 365 * 24 * 60 * 60 * 1000), zone)
	);

	function choose(when: Date) {
		onpick(when.toISOString());
		open = false;
	}

	function chooseCustom(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		// Read as wall time in the chosen zone, which is what the field shows —
		// not as the browser's local time.
		const when = fromLocalInputValue(custom, zone);
		if (!when) {
			error = t('schedule.pickDateTime');
			return;
		}
		if (when.getTime() <= Date.now()) {
			error = t('schedule.pickFuture');
			return;
		}
		if (when.getTime() > Date.now() + MAX_SCHEDULE_YEARS * 365 * 24 * 60 * 60 * 1000) {
			error = t('schedule.pickWithin', { years: MAX_SCHEDULE_YEARS });
			return;
		}

		choose(when);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="scrim" onclick={() => (open = false)}></div>

	<div class="sheet" role="dialog" aria-modal="true" aria-label={t('compose.scheduleSend')}>
		<div class="head">
			<h2>{t('compose.scheduleSend')}</h2>
			<button type="button" class="icon-btn" aria-label={t('common.close')} onclick={() => (open = false)}>
				<Icon name="close-line" size={16} />
			</button>
		</div>

		<ul class="presets">
			{#each presets as preset (preset.label)}
				<li>
					<button type="button" class="preset" onclick={() => choose(preset.when)}>
						<span class="preset-label">{preset.label}</span>
						<span class="preset-when">{dayFormat.format(preset.when)}</span>
					</button>
				</li>
			{/each}
		</ul>

		<form class="custom" onsubmit={chooseCustom}>
			<label class="field-title" for="custom-time">{t('schedule.orPick')}</label>
			<p class="zone">{t('schedule.timesIn', { zone: zone.replace('_', ' ') })}</p>
			<input
				id="custom-time"
				class="text-input"
				type="datetime-local"
				bind:value={custom}
				min={customMin}
				max={customMax}
			/>
			{#if error}<p class="error">{error}</p>{/if}
			<button type="submit" class="btn-primary schedule-btn">{t('schedule.schedule')}</button>
		</form>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: var(--color-scrim);
	}

	.sheet {
		position: fixed;
		z-index: 41;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(22rem, calc(100vw - 2rem));
		max-height: calc(100vh - 3rem);
		overflow-y: auto;
		padding: 1.125rem;
		border-radius: 1.25rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.head h2 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.presets {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0.875rem 0 0;
		padding: 0;
		list-style: none;
	}

	.preset {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.625rem;
		text-align: left;
		transition: background 0.12s;
	}

	.preset:hover {
		background: var(--color-surface-muted);
	}

	.preset-label {
		font-size: 0.875rem;
		color: var(--color-text);
	}

	.preset-when {
		font-size: 0.75rem;
		color: var(--color-muted);
		white-space: nowrap;
	}

	.custom {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.875rem;
		padding-top: 0.875rem;
		border-top: 1px solid var(--color-line);
	}

	.field-title {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.text-input {
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.text-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.schedule-btn {
		margin-top: 0.25rem;
		justify-content: center;
	}

	.zone {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
