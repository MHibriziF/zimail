<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import { detectTimeZone } from '$lib/timezone';
	import Icon from '../Icon.svelte';
	import { addDays, dateKeyToUtc } from '$lib/calendar/events';
	import { dateKeyIn } from '$lib/calendar/grid';
	import {
		MAX_PAGE_DESCRIPTION_LENGTH,
		MAX_PAGE_TITLE_LENGTH,
		SLOT_LENGTHS,
		minutesToTime,
		timeToMinutes,
		type ReservationPage,
		type ReservationPageSettings
	} from '$lib/calendar/reservations';
	import { deleteReservationPage, fetchReservationPages, saveReservationPage } from '$lib/calendar/client';

	type Draft = Omit<ReservationPageSettings, 'dayStart' | 'dayEnd'> & { dayStart: string; dayEnd: string };

	const BUFFERS = [0, 5, 10, 15, 30, 60];
	const NOTICES = [0, 60, 240, 720, 1440, 2880];
	// 27 Sept 2026 is a Sunday, so index = weekday number.
	const REFERENCE_SUNDAY = Date.UTC(2026, 8, 27);

	let pages = $state<ReservationPage[]>([]);
	let loaded = $state(false);
	let editingId = $state<string | null>(null);
	let draft = $state<Draft | null>(null);
	let saving = $state(false);
	let busyId = $state('');
	let deletingId = $state('');
	let copiedId = $state('');
	let error = $state('');

	const locale = $derived(intlLocale($page.data.locale ?? DEFAULT_LOCALE));
	const timeZone = $derived<string>($page.data.timeZone ?? (browser ? detectTimeZone() : 'UTC'));
	const weekdayNames = $derived(
		Array.from({ length: 7 }, (_, day) =>
			new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(REFERENCE_SUNDAY + day * 86_400_000)
		)
	);
	const dateFormat = $derived(new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }));

	$effect(() => {
		fetchReservationPages()
			.then((list) => (pages = list))
			.catch((failure) => (error = failure instanceof Error ? failure.message : t('common.networkError')))
			.finally(() => (loaded = true));
	});

	function linkFor(slug: string): string {
		return `${$page.url.origin}/book/${slug}`;
	}

	function openNew() {
		const today = dateKeyIn(new Date(), timeZone);
		editingId = null;
		error = '';
		draft = {
			title: '',
			description: '',
			slug: '',
			timeZone,
			startDate: today,
			endDate: addDays(today, 30),
			weekdays: [1, 2, 3, 4, 5],
			dayStart: '09:00',
			dayEnd: '17:00',
			slotMinutes: 30,
			bufferMinutes: 0,
			noticeMinutes: 240,
			active: true
		};
	}

	function openEdit(existing: ReservationPage) {
		editingId = existing.id;
		error = '';
		draft = { ...existing, description: existing.description ?? '', dayStart: minutesToTime(existing.dayStart), dayEnd: minutesToTime(existing.dayEnd) };
	}

	function toggleWeekday(day: number) {
		if (!draft) return;
		draft.weekdays = draft.weekdays.includes(day)
			? draft.weekdays.filter((entry) => entry !== day)
			: [...draft.weekdays, day].sort((a, b) => a - b);
	}

	function upsert(saved: ReservationPage) {
		pages = pages.some((entry) => entry.id === saved.id)
			? pages.map((entry) => (entry.id === saved.id ? saved : entry))
			: [...pages, saved];
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!draft || saving) return;
		saving = true;
		error = '';
		try {
			const settings: ReservationPageSettings = {
				...draft,
				dayStart: timeToMinutes(draft.dayStart) ?? -1,
				dayEnd: timeToMinutes(draft.dayEnd) ?? -1
			};
			upsert(await saveReservationPage(settings, editingId ?? undefined));
			draft = null;
			editingId = null;
		} catch (failure) {
			error = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			saving = false;
		}
	}

	async function act(id: string, action: () => Promise<void>) {
		if (busyId) return;
		busyId = id;
		error = '';
		try {
			await action();
		} catch (failure) {
			error = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			busyId = '';
		}
	}

	function toggleActive(target: ReservationPage) {
		return act(target.id, async () => {
			const { id, ...settings } = target;
			upsert(await saveReservationPage({ ...settings, active: !target.active }, id));
		});
	}

	async function copy(target: ReservationPage) {
		try {
			await navigator.clipboard.writeText(linkFor(target.slug));
			copiedId = target.id;
			setTimeout(() => {
				if (copiedId === target.id) copiedId = '';
			}, 2000);
		} catch {
			// Clipboard denied — the link is visible to copy by hand.
		}
	}
</script>

<section class="resv surface-lg">
	<header class="resv-head">
		<div>
			<h3>{t('calendar.reservations.heading')}</h3>
			<p class="resv-hint">{t('calendar.reservations.hint')}</p>
		</div>
		{#if !draft}
			<button type="button" class="resv-btn" onclick={openNew}>
				<Icon name="add-line" size={16} />
				{t('calendar.reservations.add')}
			</button>
		{/if}
	</header>

	{#if error}<p class="resv-error" role="alert">{error}</p>{/if}

	{#if draft}
		<form class="resv-form" onsubmit={submit}>
			<label class="resv-field">
				<span>{t('calendar.reservations.title')}</span>
				<input class="resv-input" type="text" bind:value={draft.title} maxlength={MAX_PAGE_TITLE_LENGTH} placeholder={t('calendar.reservations.titlePlaceholder')} required />
			</label>
			<label class="resv-field">
				<span>{t('calendar.reservations.description')}</span>
				<textarea class="resv-input" rows="2" bind:value={draft.description} maxlength={MAX_PAGE_DESCRIPTION_LENGTH}></textarea>
			</label>
			<div class="resv-row">
				<label class="resv-field">
					<span>{t('calendar.reservations.from')}</span>
					<input class="resv-input" type="date" bind:value={draft.startDate} required />
				</label>
				<label class="resv-field">
					<span>{t('calendar.reservations.to')}</span>
					<input class="resv-input" type="date" bind:value={draft.endDate} min={draft.startDate} required />
				</label>
			</div>
			<fieldset class="resv-field">
				<legend>{t('calendar.reservations.days')}</legend>
				<div class="resv-days">
					{#each weekdayNames as label, day (day)}
						<button type="button" class="resv-day" aria-pressed={draft.weekdays.includes(day)} onclick={() => toggleWeekday(day)}>{label}</button>
					{/each}
				</div>
			</fieldset>
			<div class="resv-row">
				<label class="resv-field">
					<span>{t('calendar.reservations.dayStart')}</span>
					<input class="resv-input" type="time" bind:value={draft.dayStart} required />
				</label>
				<label class="resv-field">
					<span>{t('calendar.reservations.dayEnd')}</span>
					<input class="resv-input" type="time" bind:value={draft.dayEnd} required />
				</label>
			</div>
			<div class="resv-row">
				<label class="resv-field">
					<span>{t('calendar.reservations.slot')}</span>
					<select class="resv-input" bind:value={draft.slotMinutes}>
						{#each SLOT_LENGTHS as length (length)}<option value={length}>{t('book.minutes', { count: length })}</option>{/each}
					</select>
				</label>
				<label class="resv-field">
					<span>{t('calendar.reservations.buffer')}</span>
					<select class="resv-input" bind:value={draft.bufferMinutes}>
						{#each BUFFERS as length (length)}<option value={length}>{t('book.minutes', { count: length })}</option>{/each}
					</select>
				</label>
				<label class="resv-field">
					<span>{t('calendar.reservations.notice')}</span>
					<select class="resv-input" bind:value={draft.noticeMinutes}>
						{#each NOTICES as length (length)}
							<option value={length}>{length >= 1440 ? t('calendar.reservations.noticeDays', { count: length / 1440 }) : t('calendar.reservations.noticeHours', { count: length / 60 })}</option>
						{/each}
					</select>
				</label>
			</div>
			<label class="resv-field">
				<span>{t('calendar.reservations.slug')}</span>
				<div class="resv-slug">
					<span>{$page.url.origin}/book/</span>
					<input class="resv-input" type="text" bind:value={draft.slug} maxlength={40} placeholder={t('calendar.reservations.slugPlaceholder')} />
				</div>
			</label>
			<p class="resv-hint">{t('calendar.reservations.zoneNote', { zone: draft.timeZone })}</p>
			<div class="resv-actions">
				<button type="button" class="btn-ghost" onclick={() => (draft = null)}>{t('common.cancel')}</button>
				<button type="submit" class="btn-primary" disabled={saving || draft.weekdays.length === 0}>
					{saving ? t('common.saving') : t('common.save')}
				</button>
			</div>
		</form>
	{/if}

	{#if loaded && pages.length === 0 && !draft}
		<p class="resv-empty">{t('calendar.reservations.empty')}</p>
	{:else if pages.length > 0}
		<ul class="resv-list">
			{#each pages as item (item.id)}
				<li class="resv-item">
					<div class="resv-info">
						<span class="resv-name">
							{item.title}
							{#if !item.active}<span class="resv-badge">{t('calendar.reservations.paused')}</span>{/if}
						</span>
						<a class="resv-link" href="/book/{item.slug}" target="_blank" rel="noopener">/book/{item.slug}</a>
						<span class="resv-meta">
							{dateFormat.format(dateKeyToUtc(item.startDate)!)} – {dateFormat.format(dateKeyToUtc(item.endDate)!)} ·
							{minutesToTime(item.dayStart)}–{minutesToTime(item.dayEnd)} · {t('book.minutes', { count: item.slotMinutes })}
						</span>
					</div>
					{#if deletingId === item.id}
						<button type="button" class="btn-ghost" onclick={() => (deletingId = '')}>{t('common.cancel')}</button>
						<button
							type="button"
							class="resv-btn resv-danger"
							disabled={busyId === item.id}
							onclick={() =>
								act(item.id, async () => {
									await deleteReservationPage(item.id);
									pages = pages.filter((entry) => entry.id !== item.id);
									deletingId = '';
								})}
						>
							{t('calendar.delete')}
						</button>
					{:else}
						<button type="button" class="icon-btn" title={t('calendar.reservations.copy')} aria-label={t('calendar.reservations.copy')} onclick={() => copy(item)}>
							<Icon name={copiedId === item.id ? 'check-line' : 'link'} size={16} />
						</button>
						<button
							type="button"
							class="icon-btn"
							title={item.active ? t('calendar.reservations.pause') : t('calendar.reservations.resume')}
							aria-label={item.active ? t('calendar.reservations.pause') : t('calendar.reservations.resume')}
							disabled={busyId === item.id}
							onclick={() => toggleActive(item)}
						>
							<Icon name={item.active ? 'pause-line' : 'play-line'} size={16} />
						</button>
						<button type="button" class="icon-btn" title={t('calendar.editEvent')} aria-label={t('calendar.reservations.edit')} onclick={() => openEdit(item)}>
							<Icon name="pencil-line" size={16} />
						</button>
						<button type="button" class="icon-btn" title={t('calendar.delete')} aria-label={t('calendar.delete')} onclick={() => (deletingId = item.id)}>
							<Icon name="delete-bin-line" size={16} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.resv {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
	}

	.resv-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.resv-hint,
	.resv-empty {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.resv-empty {
		color: var(--color-muted);
	}

	.resv-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.resv-btn {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4375rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		font-weight: 500;
		white-space: nowrap;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-focus-line);
	}

	.resv-danger {
		color: #fff;
		background: var(--color-danger);
		box-shadow: none;
	}

	.resv-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
	}

	.resv-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.75rem;
	}

	.resv-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.resv-input {
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font: inherit;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.resv-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.resv-days {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.resv-day {
		min-width: 3rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.resv-day[aria-pressed='true'] {
		color: var(--color-on-accent);
		background: var(--color-accent);
		box-shadow: none;
	}

	.resv-slug {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}

	.resv-slug span {
		overflow: hidden;
		font-size: 0.8125rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.resv-slug .resv-input {
		flex: 1;
	}

	.resv-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.resv-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.resv-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 0;
	}

	.resv-item + .resv-item {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.resv-info {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.0625rem;
		min-width: 0;
	}

	.resv-name {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.resv-badge {
		padding: 0 0.4375rem;
		border-radius: 999px;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.resv-link {
		overflow: hidden;
		font-size: 0.8125rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-accent-text);
	}

	.resv-meta {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}
</style>
