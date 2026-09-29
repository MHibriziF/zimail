<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import { APP_NAME } from '$lib/constants';
	import Icon from '$lib/components/Icon.svelte';
	import SlotPicker from '$lib/components/booking/SlotPicker.svelte';
	import { detectTimeZone } from '$lib/timezone';
	import type { GuestChangeBlock } from '$lib/calendar/reservations';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const booking = $derived(data.booking);

	const locale = $derived(intlLocale($page.data.locale ?? DEFAULT_LOCALE));
	const guestZone = $derived(browser ? detectTimeZone() : booking.timeZone);
	const fullFormat = $derived(
		new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: guestZone })
	);

	const BLOCK_KEYS: Record<GuestChangeBlock, string> = {
		past: 'book.blockedPast',
		too_late: 'book.blockedTooLate',
		limit_reached: 'book.blockedLimit'
	};

	let picker = $state<SlotPicker>();
	let chosen = $state('');
	let busy = $state<'reschedule' | 'cancel' | null>(null);
	let confirmingCancel = $state(false);
	let error = $state('');
	/** What happened on this visit, so the page can say so without a reload. */
	let done = $state<{ kind: 'moved'; start: string } | { kind: 'cancelled' } | null>(null);
	const start = $derived(done?.kind === 'moved' ? done.start : booking.start);

	async function act(action: 'reschedule' | 'cancel') {
		if (busy) return;
		busy = action;
		error = '';
		try {
			const response = await fetch(`/api/book/manage/${encodeURIComponent(data.token)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(action === 'cancel' ? { action } : { action, start: chosen })
			});
			const body = (await response.json().catch(() => ({}))) as { start?: string; error?: string; code?: string };
			if (response.ok) {
				done = action === 'cancel' ? { kind: 'cancelled' } : { kind: 'moved', start: body.start ?? chosen };
				return;
			}
			error = body.error ?? t('common.networkError');
			if (body.code === 'slot_taken') picker?.drop(chosen);
		} catch {
			error = t('common.networkError');
		} finally {
			busy = null;
		}
	}
</script>

<svelte:head>
	<title>{t('book.manageHeading')} — {APP_NAME}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="manage">
	<section class="manage-card surface-lg">
		<header>
			{#if booking.host}<p class="manage-host">{booking.host}</p>{/if}
			<h1>{booking.pageTitle}</h1>
			<p class="manage-when">{fullFormat.format(new Date(start))}</p>
			<p class="manage-meta">
				{#if booking.location}<span><Icon name="map-pin-line" size={15} />{booking.location}</span>{/if}
				{#if booking.meetingUrl && done?.kind !== 'cancelled'}
					<a href={booking.meetingUrl}><Icon name="vidicon-line" size={15} />{t('book.joinLink')}</a>
				{/if}
			</p>
		</header>

		{#if done?.kind === 'cancelled'}
			<p class="manage-done" role="status"><Icon name="close-circle-line" size={20} />{t('book.cancelledDone')}</p>
		{:else if done?.kind === 'moved'}
			<p class="manage-done" role="status"><Icon name="checkbox-circle-line" size={20} />{t('book.moved')}</p>
		{:else}
			<p class="manage-hint">
				{t('book.changeUntil', { time: fullFormat.format(new Date(booking.changeUntil)) })}
			</p>

			<section class="manage-section">
				<h2>{t('book.pickNewTime')}</h2>
				{#if booking.rescheduleBlock}
					<p class="manage-hint">{t(BLOCK_KEYS[booking.rescheduleBlock])}</p>
				{:else}
					<p class="manage-hint">{t('book.reschedulesLeft', { count: booking.reschedulesLeft })}</p>
					<SlotPicker
						bind:this={picker}
						bind:chosen
						url="/api/book/manage/{encodeURIComponent(data.token)}"
						pageZone={booking.timeZone}
						endDate={booking.endDate}
						{guestZone}
						{locale}
					/>
					{#if chosen}
						<div class="manage-actions">
							<span class="manage-chosen">{fullFormat.format(new Date(chosen))}</span>
							<button type="button" class="btn-primary" disabled={busy !== null} onclick={() => act('reschedule')}>
								{busy === 'reschedule' ? t('book.moving') : t('book.moveHere')}
							</button>
						</div>
					{/if}
				{/if}
			</section>

			{#if !booking.cancelBlock || booking.cancelBlock !== booking.rescheduleBlock}
				<section class="manage-section">
					{#if booking.cancelBlock}
						<p class="manage-hint">{t(BLOCK_KEYS[booking.cancelBlock])}</p>
					{:else if confirmingCancel}
						<div class="manage-confirm" role="alert">
							<span>{t('book.cancelConfirm', { host: booking.host })}</span>
							<div class="manage-actions">
								<button type="button" class="btn-ghost" onclick={() => (confirmingCancel = false)}>{t('book.keepIt')}</button>
								<button type="button" class="manage-danger" disabled={busy !== null} onclick={() => act('cancel')}>
									{busy === 'cancel' ? t('book.cancelling') : t('book.cancelAction')}
								</button>
							</div>
						</div>
					{:else}
						<button type="button" class="btn-ghost manage-cancel" onclick={() => (confirmingCancel = true)}>
							{t('book.cancelAction')}
						</button>
					{/if}
				</section>
			{/if}

			{#if error}<p class="manage-error" role="alert">{error}</p>{/if}
		{/if}
	</section>
	<p class="manage-foot">{t('book.poweredBy', { app: APP_NAME })}</p>
</main>

<style>
	.manage {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		min-height: 100dvh;
		padding: 2rem 1rem;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.manage-card {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		width: min(40rem, 100%);
		padding: 1.5rem;
	}

	.manage-host {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	h1 {
		margin: 0.25rem 0 0;
		font-size: 1.375rem;
		font-weight: 600;
	}

	.manage-when {
		margin: 0.5rem 0 0;
		font-weight: 500;
	}

	.manage-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin: 0.5rem 0 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.manage-meta span,
	.manage-meta a {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.manage-meta a {
		color: var(--color-accent-text);
	}

	.manage-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-top: 1rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.manage-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.manage-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
	}

	.manage-chosen {
		margin-right: auto;
		font-weight: 600;
	}

	.manage-confirm {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		font-size: 0.875rem;
	}

	.manage-cancel {
		align-self: flex-start;
		color: var(--color-danger);
	}

	.manage-danger {
		padding: 0.5rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-on-danger);
		background: var(--color-danger);
	}

	.manage-danger:hover:not(:disabled) {
		background: var(--color-danger-hover);
	}

	.manage-danger:disabled {
		opacity: 0.6;
	}

	.manage-done {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-weight: 500;
		color: var(--color-accent-text);
	}

	.manage-error {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.manage-foot {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}
</style>
