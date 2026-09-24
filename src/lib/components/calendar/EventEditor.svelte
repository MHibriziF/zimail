<script lang="ts">
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import type { EventDraft } from '$lib/calendar/editor';
	import { MAX_EVENT_LOCATION_LENGTH, MAX_EVENT_NOTES_LENGTH, MAX_EVENT_TITLE_LENGTH } from '$lib/calendar/events';

	let {
		initial,
		isNew,
		readOnly = false,
		busy = false,
		error = '',
		onsave,
		ondelete,
		oncancel
	}: {
		initial: EventDraft;
		isNew: boolean;
		/** Feed and reservation events are shown, not edited. */
		readOnly?: boolean;
		busy?: boolean;
		error?: string;
		onsave: (draft: EventDraft) => void;
		ondelete: () => void;
		oncancel: () => void;
	} = $props();

	let draft = $state(untrack(() => ({ ...initial })));
	let confirmingDelete = $state(false);

	const heading = $derived.by(() => {
		if (isNew) return t('calendar.newEvent');
		return readOnly ? t('calendar.eventDetails') : t('calendar.editEvent');
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!readOnly) onsave({ ...draft });
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
			<p class="cal-editor-note">{t('calendar.readOnlyHint')}</p>
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

		{#if error}<p class="cal-error" role="alert">{error}</p>{/if}

		{#if confirmingDelete}
			<div class="cal-confirm" role="alert">
				<span>{t('calendar.deleteConfirm')}</span>
				<div class="cal-actions">
					<button type="button" class="btn-ghost" onclick={() => (confirmingDelete = false)}>{t('common.cancel')}</button>
					<button type="button" class="cal-danger" disabled={busy} onclick={ondelete}>{t('calendar.delete')}</button>
				</div>
			</div>
		{:else}
			<footer class="cal-actions">
				{#if !isNew && !readOnly}
					<button type="button" class="btn-ghost cal-delete" onclick={() => (confirmingDelete = true)}>
						<Icon name="delete-bin-line" size={16} />
						{t('calendar.delete')}
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
