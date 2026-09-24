<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import { detectTimeZone } from '$lib/timezone';
	import { InvitationCard } from '$lib/calendar/invitation-card.svelte';
	import {
		SHOWN_GUESTS,
		answerHeadlineKey,
		canAcceptProposal,
		canSettleProposal,
		formatInvitationWhen,
		otherGuests
	} from '$lib/calendar/invitations';
	import type { InviteResponse } from '$lib/calendar/ics/invite';
	import type { ZeroIconName } from '../icons/names';
	import Icon from '../icons/Icon.svelte';

	let { emailId }: { emailId: string } = $props();

	const card = $derived(new InvitationCard(emailId));
	$effect(() => {
		void card.load();
	});

	const locale = $derived(intlLocale($page.data.locale ?? DEFAULT_LOCALE));
	const timeZone = $derived<string>($page.data.timeZone ?? (browser ? detectTimeZone() : 'UTC'));

	const view = $derived(card.view);
	const answer = $derived(card.answer);
	const cancelled = $derived(view?.method === 'CANCEL');
	const heading = $derived.by(() => {
		if (cancelled) return t('invitation.cancelled');
		return view?.method === 'PUBLISH' ? t('invitation.event') : t('invitation.invitation');
	});
	const guests = $derived(view ? otherGuests(view) : []);

	const ANSWERS: { response: InviteResponse; key: string; icon: ZeroIconName | null }[] = [
		{ response: 'accepted', key: 'invitation.yes', icon: 'Check' },
		{ response: 'tentative', key: 'invitation.maybe', icon: null },
		{ response: 'declined', key: 'invitation.no', icon: 'X' }
	];

	function status(response: string | null): string {
		if (response === 'accepted' || response === 'tentative' || response === 'declined') {
			return t(`invitation.${response}`);
		}
		return '';
	}
</script>

{#if view}
	<section class="z-invite" class:cancelled aria-label={heading}>
		<div class="z-invite-icon" aria-hidden="true"><Icon name="Calendar" size={18} /></div>
		<div class="z-invite-main">
			<p class="z-invite-kind">{heading}</p>
			<h3 class="z-invite-title">{view.title || t('invitation.invitation')}</h3>
			<p class="z-invite-meta"><Icon name="Clock" size={13} />{formatInvitationWhen(view, locale, timeZone)}</p>
			{#if view.recurring || view.occurrence}
				<p class="z-invite-meta">{view.occurrence ? t('invitation.occurrence') : t('invitation.repeats')}</p>
			{/if}
			{#if view.location}
				<p class="z-invite-meta">{view.location}</p>
			{/if}
			{#if view.organizer}
				<p class="z-invite-meta">
					<Icon name="User" size={13} />{t('invitation.organizer')}: {view.organizer.name ?? view.organizer.email}
				</p>
			{/if}
			{#if guests.length > 0}
				<p class="z-invite-meta">
					<Icon name="Users" size={13} />{t('invitation.guests')}:
					{guests.slice(0, SHOWN_GUESTS).map((guest) => guest.name ?? guest.email).join(', ')}
					{#if guests.length > SHOWN_GUESTS}{t('invitation.moreGuests', { count: guests.length - SHOWN_GUESTS })}{/if}
				</p>
			{/if}

			{#if view.outdated}
				<p class="z-invite-note">{t('invitation.outdated')}</p>
			{:else if cancelled}
				<p class="z-invite-note">{t('invitation.cancelledNote')}</p>
				{#if view.onCalendar}
					<div class="z-invite-actions">
						<button type="button" class="z-invite-btn" disabled={card.busy !== null} onclick={() => card.act('remove')}>
							{t('invitation.remove')}
						</button>
					</div>
				{:else}
					<p class="z-invite-note">{t('invitation.cancelledGone')}</p>
				{/if}
			{:else if view.canReply}
				<div class="z-invite-actions" role="group" aria-label={t('invitation.going')}>
					<span class="z-invite-going">{t('invitation.going')}</span>
					{#each ANSWERS as answer (answer.response)}
						<button
							type="button"
							class="z-invite-btn"
							class:chosen={view.response === answer.response}
							aria-pressed={view.response === answer.response}
							disabled={card.busy !== null}
							onclick={() => card.act(answer.response)}
						>
							{#if answer.icon}<Icon name={answer.icon} size={13} />{/if}{t(answer.key)}
						</button>
					{/each}
				</div>
			{:else}
				<div class="z-invite-actions">
					{#if view.onCalendar}
						<button type="button" class="z-invite-btn" disabled={card.busy !== null} onclick={() => card.act('remove')}>
							{t('invitation.remove')}
						</button>
					{:else}
						<button type="button" class="z-invite-btn chosen" disabled={card.busy !== null} onclick={() => card.act('add')}>
							<Icon name="Calendar" size={13} />{t('invitation.add')}
						</button>
					{/if}
				</div>
			{/if}

			{#if !cancelled && (status(view.response) || view.onCalendar)}
				<p class="z-invite-status">
					{status(view.response)}{#if status(view.response) && view.onCalendar}{' · '}{/if}{#if view.onCalendar}{t('invitation.onCalendar')}{/if}
				</p>
			{/if}
			{#if card.replied !== null}
				<p class="z-invite-note">{card.replied ? t('invitation.replied') : t('invitation.replyFailed')}</p>
			{/if}
			{#if card.error}<p class="z-invite-error" role="alert">{card.error}</p>{/if}
		</div>
	</section>
{:else if answer}
	{@const who = answer.from.name ?? answer.from.email}
	<section class="z-invite" aria-label={answer.proposed ? t('answer.proposal') : t('answer.reply')}>
		<div class="z-invite-icon" aria-hidden="true"><Icon name="Calendar" size={18} /></div>
		<div class="z-invite-main">
			<p class="z-invite-kind">{answer.proposed ? t('answer.proposal') : t('answer.reply')}</p>
			<h3 class="z-invite-title">{answer.title}</h3>
			<p class="z-invite-status">{t(answerHeadlineKey(answer), { name: who })}</p>
			{#if answer.proposed}
				<p class="z-invite-meta">
					<Icon name="Clock" size={13} />{t('answer.now')}: {formatInvitationWhen(answer.current, locale, timeZone)}
				</p>
				{#if !answer.applied}
					<p class="z-invite-meta">{t('answer.proposed')}: {formatInvitationWhen(answer.proposed, locale, timeZone)}</p>
				{/if}
			{:else}
				<p class="z-invite-meta"><Icon name="Clock" size={13} />{formatInvitationWhen(answer.current, locale, timeZone)}</p>
			{/if}
			{#if answer.comment}<p class="z-invite-note">“{answer.comment}”</p>{/if}

			{#if card.proposalDeclined}
				<p class="z-invite-note">{t('answer.kept', { name: who })}</p>
			{:else if answer.applied}
				<p class="z-invite-note">{t('answer.moved', { name: who })}</p>
			{:else if answer.proposed && answer.outdated}
				<p class="z-invite-note">{t('answer.outdated')}</p>
			{:else if canSettleProposal(answer)}
				{#if answer.conflicts.length > 0}
					<div class="z-invite-clash" role="note">
						<p>{t('answer.clashes')}</p>
						<ul>
							{#each answer.conflicts as clash, index (index)}
								<li>{clash.title} · {formatInvitationWhen(clash, locale, timeZone)}</li>
							{/each}
						</ul>
					</div>
				{/if}
				<div class="z-invite-actions">
					{#if canAcceptProposal(answer)}
						<button
							type="button"
							class="z-invite-btn chosen"
							disabled={card.busy !== null}
							onclick={() => card.settleProposal('accept-proposal')}
						>
							<Icon name="Check" size={13} />{t('answer.accept')}
						</button>
					{/if}
					<button
						type="button"
						class="z-invite-btn"
						disabled={card.busy !== null}
						onclick={() => card.settleProposal('decline-proposal')}
					>
						{t('answer.decline')}
					</button>
				</div>
			{/if}
			{#if card.error}<p class="z-invite-error" role="alert">{card.error}</p>{/if}
		</div>
	</section>
{/if}

<style>
	.z-invite {
		display: flex;
		gap: 0.75rem;
		margin: 0 0 0.875rem;
		padding: 0.75rem 0.875rem;
		border-radius: 0.625rem;
		border: 1px solid var(--z-border);
		background: var(--z-panel);
		color: var(--z-fg);
	}

	.z-invite-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.5rem;
		background: var(--z-chip);
	}

	.z-invite.cancelled .z-invite-icon {
		color: #dc2626;
	}

	.z-invite-main {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		min-width: 0;
	}

	.z-invite-kind {
		margin: 0;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--z-muted);
	}

	.z-invite-title {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.z-invite.cancelled .z-invite-title {
		text-decoration: line-through;
	}

	.z-invite-meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin: 0;
		font-size: 0.8125rem;
		color: var(--z-muted);
		overflow-wrap: anywhere;
	}

	.z-invite-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.z-invite-going {
		margin-right: 0.25rem;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.z-invite-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		height: 1.75rem;
		padding: 0 0.625rem;
		border-radius: 0.375rem;
		border: 1px solid var(--z-chip-border);
		font-size: 0.8125rem;
		color: var(--z-fg);
		background: var(--z-chip);
	}

	.z-invite-btn:hover:not(:disabled) {
		background: var(--z-hover);
	}

	.z-invite-btn.chosen {
		border-color: transparent;
		color: var(--z-on-primary);
		background: var(--z-primary);
	}

	.z-invite-btn:disabled {
		opacity: 0.6;
	}

	.z-invite-status,
	.z-invite-note {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: var(--z-muted);
	}

	.z-invite-status {
		font-weight: 500;
		color: var(--z-fg);
	}

	.z-invite-clash {
		margin-top: 0.375rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		color: #dc2626;
		background: color-mix(in srgb, #dc2626 10%, transparent);
	}

	.z-invite-clash p {
		margin: 0;
		font-weight: 500;
	}

	.z-invite-clash ul {
		margin: 0.25rem 0 0;
		padding-left: 1.125rem;
		color: var(--z-muted);
	}

	.z-invite-error {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: #dc2626;
	}
</style>
