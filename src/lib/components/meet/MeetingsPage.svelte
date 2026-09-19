<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE, intlLocale } from '$lib/i18n/locales';
	import StackHeader from '../StackHeader.svelte';
	import Icon from '../Icon.svelte';
	import { startMeeting } from '$lib/mail/meetings';
	import { describeMailError } from '$lib/mail/client';
	import type { Meeting } from '$lib/server/meet/meetings';

	let { meetings }: { meetings: Meeting[] } = $props();

	/** Meetings started from this page this session — prepended ahead of `meetings`. */
	let created = $state<Meeting[]>([]);
	/** Edits applied this session, keyed by meeting id — kept separate rather than mutating `meetings` (a plain prop, not reactive state). */
	let overrides = $state<Record<string, Partial<Pick<Meeting, 'code' | 'title' | 'require_approval'>>>>({});
	const rows = $derived([...created, ...meetings].map((meeting) => ({ ...meeting, ...overrides[meeting.id] })));

	let starting = $state(false);
	let busyId = $state('');
	let copiedId = $state('');
	let error = $state('');
	let joinCode = $state('');

	let editingId = $state('');
	let editTitle = $state('');
	let editRequireApproval = $state(false);
	let savingEdit = $state(false);

	// The app's language and saved time zone, not the browser's — and the same on
	// server and client, so the SSR'd date doesn't change on hydration.
	const dateFormat = $derived(
		new Intl.DateTimeFormat(intlLocale($page.data.locale ?? DEFAULT_LOCALE), {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: $page.data.timeZone ?? undefined
		})
	);

	function formatDate(iso: string): string {
		return dateFormat.format(new Date(iso));
	}

	function joinUrlFor(code: string): string {
		return `${$page.url.origin}/meet/${code}`;
	}

	async function startNewMeeting() {
		if (starting) return;
		starting = true;
		error = '';

		try {
			const meeting = await startMeeting();
			created = [
				{
					id: meeting.id,
					user_id: '',
					code: meeting.code,
					title: meeting.title,
					require_approval: meeting.requireApproval,
					created_at: new Date().toISOString()
				},
				...created
			];
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
		} finally {
			starting = false;
		}
	}

	async function regenerate(id: string) {
		if (busyId) return;
		busyId = id;
		error = '';

		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(id)}/rotate`, { method: 'POST' });
			const body = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
			if (!response.ok || !body.code) {
				error = body.error ?? t('meetings.couldNotRegenerate');
				return;
			}
			overrides = { ...overrides, [id]: { ...overrides[id], code: body.code } };
		} catch {
			error = t('common.networkError');
		} finally {
			busyId = '';
		}
	}

	async function copyLink(id: string, joinUrl: string) {
		try {
			await navigator.clipboard.writeText(joinUrl);
			copiedId = id;
			setTimeout(() => {
				if (copiedId === id) copiedId = '';
			}, 2000);
		} catch {
			// Clipboard access denied — the link is still visible to copy by hand.
		}
	}

	function submitJoin(event: SubmitEvent) {
		event.preventDefault();
		const code = joinCode.trim().toLowerCase();
		if (!code) return;
		void goto(`/meet/${encodeURIComponent(code)}`);
	}

	function openEdit(meeting: Meeting) {
		editingId = meeting.id;
		editTitle = meeting.title ?? '';
		editRequireApproval = meeting.require_approval;
	}

	function cancelEdit() {
		editingId = '';
	}

	async function saveEdit(id: string) {
		if (savingEdit) return;
		savingEdit = true;
		error = '';

		try {
			const response = await fetch(`/api/meetings/${encodeURIComponent(id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: editTitle, requireApproval: editRequireApproval })
			});
			const body = (await response.json().catch(() => ({}))) as {
				meeting?: { title: string | null; require_approval: boolean };
				error?: string;
			};
			if (!response.ok || !body.meeting) {
				error = body.error ?? t('meetings.couldNotSave');
				return;
			}
			overrides = {
				...overrides,
				[id]: { ...overrides[id], title: body.meeting.title, require_approval: body.meeting.require_approval }
			};
			editingId = '';
		} catch {
			error = t('common.networkError');
		} finally {
			savingEdit = false;
		}
	}
</script>

<div class="meetings-page">
	<StackHeader title={t('meetings.heading')} back={false} />

	<section class="surface-lg meetings-card meetings-start">
		<div>
			<h2>{t('meetings.startHeading')}</h2>
			<p class="meetings-hint">{t('meetings.hint')}</p>
		</div>
		<div class="meetings-start-actions">
			<button type="button" class="btn-primary" disabled={starting} onclick={startNewMeeting}>
				<Icon name="video-add-line" size={18} />
				{starting ? t('meetings.creating') : t('meetings.newMeeting')}
			</button>
			<span class="meetings-or">{t('meetings.or')}</span>
			<form class="meetings-join" onsubmit={submitJoin}>
				<input
					class="meetings-input"
					type="text"
					bind:value={joinCode}
					placeholder={t('meetings.joinPlaceholder')}
					aria-label={t('meetings.joinPlaceholder')}
				/>
				<button type="submit" class="meetings-btn" disabled={!joinCode.trim()}>{t('meetings.joinButton')}</button>
			</form>
		</div>
	</section>

	{#if error}
		<p class="meetings-error" role="alert">{error}</p>
	{/if}

	<section class="meetings-list-section">
		<h2 class="meetings-section-title">
			{t('meetings.listHeading')}
			{#if rows.length > 0}<span class="meetings-count">{rows.length}</span>{/if}
		</h2>

		{#if rows.length === 0}
			<div class="surface-lg meetings-card meetings-empty">
				<Icon name="vidicon-line" size={28} />
				<p class="meetings-empty-title">{t('meetings.empty')}</p>
				<p class="meetings-hint">{t('meetings.emptyHint')}</p>
			</div>
		{:else}
			<ul class="surface-lg meetings-list">
				{#each rows as meeting (meeting.id)}
					<li class="meetings-item">
						<div class="meetings-row">
							<div class="meetings-row-icon" aria-hidden="true">
								<Icon name="vidicon-line" size={18} />
							</div>
							<div class="meetings-row-info">
								<span class="meetings-row-title">{meeting.title || t('meetings.untitled')}</span>
								<span class="meetings-row-meta">
									{#if meeting.code}<code class="meetings-code">{meeting.code}</code>{/if}
									<span>{formatDate(meeting.created_at)}</span>
									{#if meeting.require_approval}
										<span class="meetings-badge">{t('meetings.admissionBadge')}</span>
									{/if}
								</span>
							</div>
							<div class="meetings-row-actions">
								{#if meeting.code}
									<a class="meetings-btn meetings-btn-accent" href="/meet/{meeting.code}">{t('meetings.open')}</a>
									<button type="button" class="meetings-btn" onclick={() => copyLink(meeting.id, joinUrlFor(meeting.code!))}>
										<Icon name={copiedId === meeting.id ? 'check-line' : 'link'} size={16} />
										{copiedId === meeting.id ? t('meetings.linkCopied') : t('meetings.copyLink')}
									</button>
								{/if}
								<button
									type="button"
									class="icon-btn"
									title={t('meetings.edit')}
									aria-label={t('meetings.edit')}
									aria-expanded={editingId === meeting.id}
									onclick={() => (editingId === meeting.id ? cancelEdit() : openEdit(meeting))}
								>
									<Icon name="pencil-line" size={16} />
								</button>
								<button
									type="button"
									class="icon-btn"
									title={t('meetings.regenerateCode')}
									aria-label={t('meetings.regenerateCode')}
									disabled={busyId === meeting.id}
									onclick={() => regenerate(meeting.id)}
								>
									<Icon name="refresh-line" size={16} />
								</button>
							</div>
						</div>

						{#if editingId === meeting.id}
							<div class="meetings-edit">
								<label class="meetings-edit-field">
									<span>{t('meetings.titleLabel')}</span>
									<input class="meetings-input" type="text" bind:value={editTitle} maxlength={200} />
								</label>
								<fieldset class="meetings-edit-field">
									<legend>{t('meetings.admissionLabel')}</legend>
									<label class="meetings-edit-radio">
										<input type="radio" name="admission-{meeting.id}" checked={!editRequireApproval} onchange={() => (editRequireApproval = false)} />
										{t('meetings.admissionOpen')}
									</label>
									<label class="meetings-edit-radio">
										<input type="radio" name="admission-{meeting.id}" checked={editRequireApproval} onchange={() => (editRequireApproval = true)} />
										{t('meetings.admissionApproval')}
									</label>
								</fieldset>
								<div class="meetings-edit-actions">
									<button type="button" class="btn-ghost" onclick={cancelEdit}>{t('common.cancel')}</button>
									<button type="button" class="btn-primary" disabled={savingEdit} onclick={() => saveEdit(meeting.id)}>
										{savingEdit ? t('common.saving') : t('common.save')}
									</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.meetings-page {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		max-width: 48rem;
	}

	.meetings-page :global(.stack-header) {
		margin-bottom: 0;
	}

	.meetings-card {
		padding: 1.5rem;
	}

	.meetings-start {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.meetings-start h2,
	.meetings-section-title {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.meetings-hint {
		margin: 0.375rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.meetings-start-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.meetings-or {
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.meetings-join {
		display: flex;
		flex: 1;
		gap: 0.5rem;
		min-width: 14rem;
	}

	.meetings-input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.meetings-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.meetings-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		flex-shrink: 0;
		padding: 0.4375rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		font-weight: 500;
		white-space: nowrap;
		text-decoration: none;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-focus-line);
		transition: background 0.15s;
	}

	.meetings-btn:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.meetings-btn:disabled {
		opacity: 0.45;
	}

	.meetings-btn-accent {
		color: var(--color-accent-text);
		background: var(--color-accent-soft);
		box-shadow: none;
	}

	.meetings-error {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.meetings-list-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.meetings-section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.25rem;
	}

	.meetings-count {
		padding: 0 0.4375rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.meetings-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		text-align: center;
		color: var(--color-muted);
	}

	.meetings-empty-title {
		margin: 0.5rem 0 0;
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.meetings-empty .meetings-hint {
		max-width: 26rem;
	}

	.meetings-list {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow: hidden;
	}

	.meetings-item + .meetings-item {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.meetings-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.875rem;
		padding: 0.875rem 1.25rem;
	}

	.meetings-row-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.75rem;
		color: var(--color-accent-text);
		background: var(--color-accent-soft);
	}

	.meetings-row-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.meetings-row-title {
		font-size: 0.9375rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meetings-row-meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem 0.625rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.meetings-code {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.meetings-badge {
		padding: 0.0625rem 0.4375rem;
		border-radius: 999px;
		color: var(--color-accent-text);
		background: var(--color-accent-soft);
	}

	.meetings-row-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.meetings-row-actions .icon-btn:disabled {
		opacity: 0.45;
	}

	.meetings-edit {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		margin: 0 1.25rem 1rem;
		padding: 1rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
	}

	.meetings-edit .meetings-input {
		background: var(--color-surface);
	}

	.meetings-edit-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		border: none;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.meetings-edit-field legend {
		margin-bottom: 0.375rem;
		padding: 0;
	}

	.meetings-edit-radio {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text);
	}

	.meetings-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	@media (max-width: 900px) {
		.meetings-page {
			max-width: none;
			gap: 1rem;
			padding-bottom: 1.5rem;
		}

		.meetings-card,
		.meetings-list {
			box-shadow: none;
		}

		.meetings-card {
			padding: 1.25rem 1rem;
		}
	}

	@media (max-width: 560px) {
		.meetings-or {
			display: none;
		}

		.meetings-start-actions > .btn-primary,
		.meetings-join {
			width: 100%;
			min-width: 0;
		}

		.meetings-row {
			grid-template-columns: auto minmax(0, 1fr);
			padding: 0.875rem 1rem;
		}

		/* Actions drop under the title so the title never gets squeezed to nothing. */
		.meetings-row-actions {
			grid-column: 1 / -1;
			flex-wrap: wrap;
		}

		.meetings-edit {
			margin: 0 1rem 1rem;
		}
	}
</style>
