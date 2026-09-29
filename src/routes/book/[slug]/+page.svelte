<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import { APP_NAME } from '$lib/constants';
	import Icon from '$lib/components/Icon.svelte';
	import { detectTimeZone } from '$lib/timezone';
	import { MAX_GUEST_NAME_LENGTH, MAX_GUEST_NOTE_LENGTH } from '$lib/calendar/reservations';
	import SlotPicker from '$lib/components/booking/SlotPicker.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const reservation = $derived(data.reservation);
	const previewDescription = $derived(
		reservation.description?.trim() || t('book.previewDescription', { host: reservation.host })
	);

	const locale = $derived(intlLocale($page.data.locale ?? DEFAULT_LOCALE));
	// Guests read times in their own zone; the page's zone only decides which hours exist.
	const guestZone = $derived(browser ? detectTimeZone() : reservation.timeZone);
	const fullFormat = $derived(
		new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: guestZone })
	);

	let picker = $state<SlotPicker>();
	let chosen = $state('');
	let name = $state('');
	let email = $state('');
	let note = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let booked = $state<{ start: string; end: string; meetingUrl: string | null } | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!chosen || submitting) return;
		submitting = true;
		submitError = '';
		try {
			const response = await fetch(`/api/book/${encodeURIComponent(reservation.slug)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ start: chosen, name, email, note })
			});
			const body = (await response.json().catch(() => ({}))) as {
				start?: string;
				end?: string;
				meetingUrl?: string | null;
				error?: string;
				code?: string;
			};
			if (response.ok && body.start && body.end) {
				booked = { start: body.start, end: body.end, meetingUrl: body.meetingUrl ?? null };
				return;
			}
			submitError = body.error ?? t('book.couldNotBook');
			if (body.code === 'slot_taken') picker?.drop(chosen);
		} catch {
			submitError = t('common.networkError');
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{reservation.title} — {APP_NAME}</title>
	<meta name="robots" content="noindex" />
	<meta property="og:title" content={reservation.title} />
	<meta property="og:description" content={previewDescription} />
	<meta name="description" content={previewDescription} />
</svelte:head>

<main class="book">
	<section class="book-card surface-lg">
		<header class="book-head">
			{#if reservation.host}<p class="book-host">{reservation.host}</p>{/if}
			<h1>{reservation.title}</h1>
			<p class="book-meta">
				<span><Icon name="time-line" size={15} />{t('book.minutes', { count: reservation.slotMinutes })}</span>
				<span><Icon name="global-line" size={15} />{t('book.timesIn', { zone: guestZone })}</span>
				{#if reservation.location}
					<span><Icon name="map-pin-line" size={15} />{reservation.location}</span>
				{/if}
				{#if reservation.withMeeting}
					<span><Icon name="vidicon-line" size={15} />{t('book.videoCall')}</span>
				{/if}
			</p>
			{#if reservation.description}<p class="book-description">{reservation.description}</p>{/if}
		</header>

		{#if booked}
			<div class="book-done" role="status">
				<Icon name="checkbox-circle-line" size={36} />
				<h2>{t('book.confirmed')}</h2>
				<p>{fullFormat.format(new Date(booked.start))}</p>
				{#if booked.meetingUrl}
					<a class="btn-primary book-join" href={booked.meetingUrl}>
						<Icon name="vidicon-line" size={16} />
						{t('book.joinLink')}
					</a>
					<p class="book-hint book-link">{booked.meetingUrl}</p>
				{/if}
				<p class="book-hint">{t('book.confirmationSent', { email })}</p>
			</div>
		{:else}
			<SlotPicker
				bind:this={picker}
				bind:chosen
				url="/api/book/{encodeURIComponent(reservation.slug)}"
				pageZone={reservation.timeZone}
				endDate={reservation.endDate}
				{guestZone}
				{locale}
			/>

			{#if chosen}
				<form class="book-form" onsubmit={submit}>
					<p class="book-chosen">{fullFormat.format(new Date(chosen))}</p>
					<label>
						<span>{t('book.name')}</span>
						<input type="text" bind:value={name} maxlength={MAX_GUEST_NAME_LENGTH} autocomplete="name" required />
					</label>
					<label>
						<span>{t('book.email')}</span>
						<input type="email" bind:value={email} maxlength={254} autocomplete="email" required />
					</label>
					<label>
						<span>{t('book.note')}</span>
						<textarea rows="3" bind:value={note} maxlength={MAX_GUEST_NOTE_LENGTH}></textarea>
					</label>
					{#if submitError}<p class="book-error" role="alert">{submitError}</p>{/if}
					<button type="submit" class="btn-primary" disabled={submitting}>
						{submitting ? t('book.booking') : t('book.confirm')}
					</button>
				</form>
			{/if}
		{/if}
	</section>
	<p class="book-foot">{t('book.poweredBy', { app: APP_NAME })}</p>
</main>

<style>
	.book {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		min-height: 100dvh;
		padding: 2rem 1rem;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.book-card {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		width: min(40rem, 100%);
		padding: 1.5rem;
	}

	.book-host {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	h1 {
		margin: 0.25rem 0 0;
		font-size: 1.375rem;
		font-weight: 600;
	}

	.book-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.book-meta span {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.book-description {
		margin: 0.75rem 0 0;
		font-size: 0.9375rem;
		line-height: 1.6;
		white-space: pre-line;
	}

	.book-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 1rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.book-chosen {
		margin: 0;
		font-weight: 600;
	}

	.book-form label {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.book-form input,
	.book-form textarea {
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font: inherit;
		font-size: 0.9375rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.book-form input:focus,
	.book-form textarea:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.book-error {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.book-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.book-done {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 1.5rem 0;
		text-align: center;
		color: var(--color-accent-text);
	}

	.book-done h2 {
		margin: 0.25rem 0 0;
		font-size: 1.125rem;
		color: var(--color-text);
	}

	.book-done p {
		margin: 0;
		color: var(--color-text);
	}

	.book-join {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.75rem;
		text-decoration: none;
	}

	.book-link {
		font-family: var(--font-mono, monospace);
		font-size: 0.75rem;
		word-break: break-all;
	}

	.book-foot {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}
</style>
