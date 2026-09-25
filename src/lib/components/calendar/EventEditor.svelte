<script lang="ts">
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import { addGuests, guestStatusKey, type EventDraft } from '$lib/calendar/editor';
	import {
		MAX_EVENT_LOCATION_LENGTH,
		MAX_EVENT_NOTES_LENGTH,
		MAX_EVENT_TITLE_LENGTH,
		type CalendarEventSource,
		type EventGuest
	} from '$lib/calendar/events';

	let {
		initial,
		isNew,
		source = 'manual',
		readOnly = false,
		deletable = true,
		busy = false,
		error = '',
		guests = [],
		meetingCode = null,
		meetingsAvailable = false,
		onsave,
		ondelete,
		oncancel
	}: {
		initial: EventDraft;
		isNew: boolean;
		source?: CalendarEventSource;
		/** Feed, reservation and invitation events are shown, not edited. */
		readOnly?: boolean;
		/** A booking is read-only but can still be cancelled. */
		deletable?: boolean;
		busy?: boolean;
		error?: string;
		/** The saved guest list with each guest's answer. */
		guests?: EventGuest[];
		meetingCode?: string | null;
		meetingsAvailable?: boolean;
		onsave: (draft: EventDraft) => void;
		ondelete: () => void;
		oncancel: () => void;
	} = $props();

	let draft = $state(untrack(() => ({ ...initial })));
	let confirmingDelete = $state(false);
	let guestText = $state('');
	let guestError = $state('');

	const answers = $derived(new Map(guests.map((guest) => [guest.email, guest.status])));

	/** Takes what's typed as guests; `false` if it had to stay in the field. */
	function commitGuests(): boolean {
		if (!draft.guests || !guestText.trim()) return true;
		const entry = addGuests(draft.guests, guestText);
		guestError = entry.error ? t(entry.error.key, entry.error.values) : '';
		if (entry.error) return false;
		draft.guests = entry.guests;
		guestText = '';
		return true;
	}

	function onGuestKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commitGuests();
		} else if (event.key === 'Backspace' && !guestText && draft.guests?.length) {
			draft.guests = draft.guests.slice(0, -1);
		}
	}

	function removeGuest(email: string) {
		draft.guests = draft.guests?.filter((guest) => guest !== email) ?? null;
	}

	/** A booking is cancelled (the guest is told), an invitation just taken off, anything else deleted. */
	const removal = $derived.by(() => {
		if (source === 'invite') {
			return { label: t('calendar.removeInvite'), confirm: t('calendar.removeInviteConfirm'), hint: t('calendar.inviteHint') };
		}
		if (source === 'reservation') {
			return { label: t('calendar.cancelBooking'), confirm: t('calendar.cancelBookingConfirm'), hint: t('calendar.bookingHint') };
		}
		return { label: t('calendar.delete'), confirm: t('calendar.deleteConfirm'), hint: t('calendar.readOnlyHint') };
	});

	const heading = $derived.by(() => {
		if (isNew) return t('calendar.newEvent');
		return readOnly ? t('calendar.eventDetails') : t('calendar.editEvent');
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!readOnly && commitGuests()) onsave({ ...draft, guests: draft.guests && [...draft.guests] });
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') oncancel();
	}
</script>

<div class="cal-scrim" role="presentation" onclick={oncancel}></div>
<div
	class="cal-editor surface-lg"
	role="dialog"
	aria-modal="true"
	aria-label={heading}
	tabindex="-1"
	onkeydown={onKey}
>
	<form onsubmit={submit}>
		<header class="cal-editor-head">
			<h2>{heading}</h2>
			<button type="button" class="icon-btn" aria-label={t('common.close')} onclick={oncancel}>
				<Icon name="close-line" size={18} />
			</button>
		</header>

		{#if readOnly}
			<p class="cal-editor-note">{removal.hint}</p>
		{/if}

		<label class="cal-field">
			<span>{t('calendar.titleLabel')}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="cal-input"
				type="text"
				bind:value={draft.title}
				maxlength={MAX_EVENT_TITLE_LENGTH}
				placeholder={t('calendar.titlePlaceholder')}
				disabled={readOnly}
				autofocus={isNew}
				required
			/>
		</label>

		<label class="cal-check">
			<input type="checkbox" bind:checked={draft.allDay} disabled={readOnly} />
			{t('calendar.allDay')}
		</label>

		<div class="cal-when">
			<label class="cal-field">
				<span>{t('calendar.starts')}</span>
				<div class="cal-when-row">
					<input class="cal-input" type="date" bind:value={draft.startDate} disabled={readOnly} required />
					{#if !draft.allDay}
						<input class="cal-input" type="time" bind:value={draft.startTime} disabled={readOnly} required />
					{/if}
				</div>
			</label>
			<label class="cal-field">
				<span>{t('calendar.ends')}</span>
				<div class="cal-when-row">
					<input class="cal-input" type="date" bind:value={draft.endDate} disabled={readOnly} required />
					{#if !draft.allDay}
						<input class="cal-input" type="time" bind:value={draft.endTime} disabled={readOnly} required />
					{/if}
				</div>
			</label>
		</div>

		<label class="cal-field">
			<span>{t('calendar.location')}</span>
			<input
				class="cal-input"
				type="text"
				bind:value={draft.location}
				maxlength={MAX_EVENT_LOCATION_LENGTH}
				disabled={readOnly}
			/>
		</label>

		<label class="cal-field">
			<span>{t('calendar.notes')}</span>
			<textarea class="cal-input" rows="3" bind:value={draft.notes} maxlength={MAX_EVENT_NOTES_LENGTH} disabled={readOnly}
			></textarea>
		</label>

		{#if !readOnly}
			<div class="cal-field">
				<label for="cal-guest-input">{t('calendar.guests')}</label>
				{#if draft.guests}
					<div class="cal-guests">
						{#each draft.guests as email (email)}
							{@const status = guestStatusKey(answers.get(email))}
							<span class="cal-guest">
								<span class="cal-guest-email">{email}</span>
								{#if status}<span class="cal-guest-status" data-status={answers.get(email)}>{t(status)}</span>{/if}
								<button
									type="button"
									class="cal-guest-remove"
									aria-label={t('calendar.removeGuest', { email })}
									onclick={() => removeGuest(email)}
								>
									<Icon name="close-line" size={14} />
								</button>
							</span>
						{/each}
						<input
							id="cal-guest-input"
							class="cal-guest-input"
							type="text"
							inputmode="email"
							autocomplete="off"
							bind:value={guestText}
							placeholder={t('calendar.guestsPlaceholder')}
							onkeydown={onGuestKey}
							onblur={commitGuests}
						/>
					</div>
					{#if guestError}
						<small class="cal-help cal-help-error" role="alert">{guestError}</small>
					{:else}
						<small class="cal-help">{t('calendar.guestsHint')}</small>
					{/if}
				{:else}
					<small class="cal-help">{t('calendar.guestsUnavailable')}</small>
				{/if}
			</div>

			<label class="cal-check cal-meeting">
				<input type="checkbox" bind:checked={draft.withMeeting} disabled={!meetingsAvailable && !meetingCode} />
				<span>
					{t('calendar.withMeeting')}
					<small class="cal-help">
						{meetingsAvailable || meetingCode ? t('calendar.withMeetingHint') : t('calendar.reservations.withMeetingUnavailable')}
					</small>
				</span>
			</label>
		{/if}

		{#if meetingCode && draft.withMeeting}
			<a class="cal-join" href="/meet/{meetingCode}" target="_blank" rel="noopener">
				<Icon name="video-on-line" size={16} />
				{t('calendar.joinMeeting')}
			</a>
		{/if}

		{#if error}<p class="cal-error" role="alert">{error}</p>{/if}

		{#if confirmingDelete}
			<div class="cal-confirm" role="alert">
				<span>{removal.confirm}</span>
				<div class="cal-actions">
					<button type="button" class="btn-ghost" onclick={() => (confirmingDelete = false)}>{t('common.cancel')}</button>
					<button type="button" class="cal-danger" disabled={busy} onclick={ondelete}>{removal.label}</button>
				</div>
			</div>
		{:else}
			<footer class="cal-actions">
				{#if !isNew && deletable}
					<button type="button" class="btn-ghost cal-delete" onclick={() => (confirmingDelete = true)}>
						<Icon name="delete-bin-line" size={16} />
						{removal.label}
					</button>
				{/if}
				<span class="cal-spacer"></span>
				<button type="button" class="btn-ghost" onclick={oncancel}>
					{readOnly ? t('common.close') : t('common.cancel')}
				</button>
				{#if !readOnly}
					<button type="submit" class="btn-primary" disabled={busy}>
						{busy ? t('common.saving') : t('common.save')}
					</button>
				{/if}
			</footer>
		{/if}
	</form>
</div>

<style>
	.cal-scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: var(--color-scrim);
	}

	.cal-editor {
		position: fixed;
		z-index: 61;
		top: 50%;
		left: 50%;
		width: min(30rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		padding: 1.25rem;
		transform: translate(-50%, -50%);
		background: var(--color-surface);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.cal-editor-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.cal-editor-head h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}

	.cal-editor-note {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.cal-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.cal-when {
		display: grid;
		gap: 0.75rem;
	}

	.cal-when-row input[type='date'] {
		flex: 1.4;
	}

	.cal-when-row {
		display: flex;
		gap: 0.5rem;
	}

	.cal-input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font: inherit;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		resize: vertical;
	}

	.cal-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.cal-input:disabled {
		opacity: 0.8;
	}

	.cal-check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.cal-help {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.cal-help-error {
		color: var(--color-danger);
	}

	.cal-guests {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0.375rem;
		border-radius: 0.625rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.cal-guests:focus-within {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.cal-guest {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		max-width: 100%;
		padding: 0.1875rem 0.25rem 0.1875rem 0.5rem;
		border-radius: 999px;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.cal-guest-email {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cal-guest-status {
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}

	.cal-guest-status[data-status='accepted'] {
		color: var(--color-accent);
	}

	.cal-guest-status[data-status='declined'] {
		color: var(--color-danger);
	}

	.cal-guest-remove {
		display: inline-flex;
		padding: 0.125rem;
		border-radius: 999px;
		color: var(--color-text-secondary);
	}

	.cal-guest-remove:hover {
		color: var(--color-text);
		background: var(--color-surface-muted);
	}

	.cal-guest-input {
		flex: 1;
		min-width: 10rem;
		padding: 0.25rem 0.375rem;
		border: 0;
		font: inherit;
		font-size: 0.875rem;
		color: var(--color-text);
		background: transparent;
	}

	.cal-guest-input:focus {
		outline: none;
	}

	.cal-meeting {
		align-items: flex-start;
	}

	.cal-meeting input {
		margin-top: 0.2rem;
	}

	.cal-meeting small {
		display: block;
	}

	.cal-join {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		align-self: flex-start;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-accent);
	}

	.cal-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.cal-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.cal-spacer {
		flex: 1;
	}

	.cal-delete {
		color: var(--color-danger);
	}

	.cal-confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.cal-danger {
		padding: 0.4375rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: #fff;
		background: var(--color-danger);
	}

	.cal-danger:disabled {
		opacity: 0.5;
	}
</style>
