<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import { detectTimeZone } from '$lib/timezone';
	import { InvitationCard, formatInvitationWhen } from '$lib/calendar/invitation-card.svelte';
	import { SHOWN_GUESTS, otherGuests } from '$lib/calendar/invitations';
	import type { InviteResponse } from '$lib/calendar/ics/invite';
	import Icon from '../Icon.svelte';

	let { emailId }: { emailId: string } = $props();

	const card = $derived(new InvitationCard(emailId));
	$effect(() => {
		void card.load();
	});

	const locale = $derived(intlLocale($page.data.locale ?? DEFAULT_LOCALE));
	const timeZone = $derived<string>($page.data.timeZone ?? (browser ? detectTimeZone() : 'UTC'));

	const view = $derived(card.view);
	const cancelled = $derived(view?.method === 'CANCEL');
	const heading = $derived.by(() => {
		if (cancelled) return t('invitation.cancelled');
		return view?.method === 'PUBLISH' ? t('invitation.event') : t('invitation.invitation');
	});
	const guests = $derived(view ? otherGuests(view) : []);

	const ANSWERS: { response: InviteResponse; key: string; icon: string }[] = [
		{ response: 'accepted', key: 'invitation.yes', icon: 'check-line' },
		{ response: 'tentative', key: 'invitation.maybe', icon: 'question-line' },
		{ response: 'declined', key: 'invitation.no', icon: 'close-line' }
	];

	function status(response: string | null): string {
		if (response === 'accepted' || response === 'tentative' || response === 'declined') {
			return t(`invitation.${response}`);
		}
		return '';
	}
</script>

{#if view}
	<section class="invite" class:cancelled aria-label={heading}>
		<div class="invite-date" aria-hidden="true">
			<Icon name={cancelled ? 'calendar-close-line' : 'calendar-event-line'} size={20} />
		</div>
		<div class="invite-main">
			<p class="invite-kind">{heading}</p>
			<h3 class="invite-title">{view.title || t('invitation.invitation')}</h3>
			<p class="invite-meta"><Icon name="time-line" size={14} />{formatInvitationWhen(view, locale, timeZone)}</p>
			{#if view.recurring || view.occurrence}
				<p class="invite-meta">
					<Icon name="repeat-line" size={14} />{view.occurrence ? t('invitation.occurrence') : t('invitation.repeats')}
				</p>
			{/if}
			{#if view.location}
				<p class="invite-meta"><Icon name="map-pin-line" size={14} />{view.location}</p>
			{/if}
			{#if view.organizer}
				<p class="invite-meta">
					<Icon name="user-line" size={14} />{t('invitation.organizer')}: {view.organizer.name ?? view.organizer.email}
				</p>
			{/if}
			{#if guests.length > 0}
				<p class="invite-meta">
					<Icon name="group-line" size={14} />{t('invitation.guests')}:
					{guests.slice(0, SHOWN_GUESTS).map((guest) => guest.name ?? guest.email).join(', ')}
					{#if guests.length > SHOWN_GUESTS}{t('invitation.moreGuests', { count: guests.length - SHOWN_GUESTS })}{/if}
				</p>
			{/if}

			{#if view.outdated}
				<p class="invite-note">{t('invitation.outdated')}</p>
			{:else if cancelled}
				<p class="invite-note">{t('invitation.cancelledNote')}</p>
				{#if view.onCalendar}
					<div class="invite-actions">
						<button type="button" class="invite-btn" disabled={card.busy !== null} onclick={() => card.act('remove')}>
							<Icon name="calendar-close-line" size={15} />{t('invitation.remove')}
						</button>
					</div>
				{:else}
					<p class="invite-note">{t('invitation.cancelledGone')}</p>
				{/if}
			{:else if view.canReply}
				<div class="invite-actions" role="group" aria-label={t('invitation.going')}>
					<span class="invite-going">{t('invitation.going')}</span>
					{#each ANSWERS as answer (answer.response)}
						<button
							type="button"
							class="invite-btn"
							class:chosen={view.response === answer.response}
							aria-pressed={view.response === answer.response}
							disabled={card.busy !== null}
							onclick={() => card.act(answer.response)}
						>
							<Icon name={answer.icon} size={15} />{t(answer.key)}
						</button>
					{/each}
				</div>
			{:else}
				<div class="invite-actions">
					{#if view.onCalendar}
						<button type="button" class="invite-btn" disabled={card.busy !== null} onclick={() => card.act('remove')}>
							<Icon name="calendar-close-line" size={15} />{t('invitation.remove')}
						</button>
					{:else}
						<button type="button" class="invite-btn chosen" disabled={card.busy !== null} onclick={() => card.act('add')}>
							<Icon name="calendar-check-line" size={15} />{t('invitation.add')}
						</button>
					{/if}
				</div>
			{/if}

			{#if !cancelled && (status(view.response) || view.onCalendar)}
				<p class="invite-status">
					{status(view.response)}{#if status(view.response) && view.onCalendar}{' · '}{/if}{#if view.onCalendar}{t('invitation.onCalendar')}{/if}
				</p>
			{/if}
			{#if card.replied !== null}
				<p class="invite-note">{card.replied ? t('invitation.replied') : t('invitation.replyFailed')}</p>
			{/if}
			{#if card.error}<p class="invite-error" role="alert">{card.error}</p>{/if}
		</div>
	</section>
{/if}

<style>
	.invite {
		display: flex;
		gap: 0.875rem;
		margin: 0 0 1rem;
		padding: 0.875rem 1rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.invite-date {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 0.625rem;
		color: var(--color-accent-text);
		background: var(--color-accent-soft);
	}

	.invite.cancelled .invite-date {
		color: var(--color-danger);
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
	}

	.invite-main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.invite-kind {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-secondary);
	}

	.invite-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.invite.cancelled .invite-title {
		text-decoration: line-through;
	}

	.invite-meta {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.invite-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.invite-going {
		margin-right: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.invite-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
		padding: 0.375rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-focus-line);
	}

	.invite-btn.chosen {
		color: var(--color-on-accent);
		background: var(--color-accent);
		box-shadow: none;
	}

	.invite-btn:disabled {
		opacity: 0.6;
	}

	.invite-status,
	.invite-note {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.invite-status {
		font-weight: 500;
		color: var(--color-accent-text);
	}

	.invite-error {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
