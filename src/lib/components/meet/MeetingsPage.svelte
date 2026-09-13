<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
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

<StackHeader title={t('meetings.heading')}>
	<div class="meetings-page">
		<div class="meetings-intro">
			<p class="meetings-hint">{t('meetings.hint')}</p>
			<button type="button" class="meetings-new-btn" disabled={starting} onclick={startNewMeeting}>
				<Icon name="video-add-line" size={18} />
				{starting ? t('meetings.creating') : t('meetings.newMeeting')}
			</button>
		</div>

		<form class="meetings-join" onsubmit={submitJoin}>
			<input
				class="meetings-join-input"
				type="text"
				bind:value={joinCode}
				placeholder={t('meetings.joinPlaceholder')}
				aria-label={t('meetings.joinPlaceholder')}
			/>
			<button type="submit" class="meetings-row-action" disabled={!joinCode.trim()}>{t('meetings.joinButton')}</button>
		</form>

		{#if error}
			<p class="meetings-error">{error}</p>
		{/if}

		{#if rows.length === 0}
			<p class="meetings-empty">{t('meetings.empty')}</p>
		{:else}
			<ul class="meetings-list">
				{#each rows as meeting (meeting.id)}
					<li class="meetings-item">
						<div class="meetings-row">
							<div class="meetings-row-info">
								<span class="meetings-row-title">{meeting.title || t('meetings.untitled')}</span>
								<span class="meetings-row-date">
									{new Date(meeting.created_at).toLocaleString()}
									{#if meeting.require_approval}
										· {t('meetings.admissionBadge')}
									{/if}
								</span>
							</div>
							<div class="meetings-row-actions">
								{#if meeting.code}
									<code class="meetings-code">{meeting.code}</code>
									<button type="button" class="meetings-row-action" onclick={() => copyLink(meeting.id, joinUrlFor(meeting.code!))}>
										{copiedId === meeting.id ? t('meetings.linkCopied') : t('meetings.copyLink')}
									</button>
								{/if}
								<button type="button" class="meetings-row-action" onclick={() => openEdit(meeting)}>
									{t('meetings.edit')}
								</button>
								<button
									type="button"
									class="meetings-row-action"
									disabled={busyId === meeting.id}
									onclick={() => regenerate(meeting.id)}
								>
									{t('meetings.regenerateCode')}
								</button>
							</div>
						</div>

						{#if editingId === meeting.id}
							<div class="meetings-edit">
								<label class="meetings-edit-field">
									<span>{t('meetings.titleLabel')}</span>
									<input class="meetings-join-input" type="text" bind:value={editTitle} maxlength={200} />
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
									<button type="button" class="meetings-row-action" onclick={cancelEdit}>{t('common.cancel')}</button>
									<button type="button" class="meetings-new-btn" disabled={savingEdit} onclick={() => saveEdit(meeting.id)}>
										{savingEdit ? t('common.saving') : t('common.save')}
									</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</StackHeader>

<style>
	.meetings-page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
	}

	.meetings-intro {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.meetings-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.meetings-new-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		border: none;
		border-radius: 0.5rem;
		background: var(--color-accent);
		color: var(--color-on-accent);
		cursor: pointer;
	}

	.meetings-new-btn:hover {
		background: var(--color-accent-hover);
	}

	.meetings-new-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.meetings-join {
		display: flex;
		gap: 0.5rem;
		padding: 0.875rem;
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.meetings-join-input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 0.625rem;
		font-size: 0.8125rem;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		background: var(--color-surface);
		color: var(--color-text);
	}

	.meetings-error {
		font-size: 0.875rem;
		color: var(--color-danger);
	}

	.meetings-empty {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.meetings-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.meetings-item {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.75rem;
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.meetings-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.meetings-edit {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding-top: 0.625rem;
		border-top: 1px solid var(--color-line);
	}

	.meetings-edit-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		border: none;
		font-size: 0.8125rem;
	}

	.meetings-edit-field legend {
		padding: 0;
		font-size: 0.8125rem;
	}

	.meetings-edit-radio {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 400;
	}

	.meetings-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.meetings-row-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.meetings-row-title {
		font-size: 0.9rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meetings-row-date {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.meetings-row-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.meetings-code {
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		font-family: var(--font-mono, monospace);
		border-radius: 0.375rem;
		background: var(--color-surface-2, var(--color-surface));
	}

	.meetings-row-action {
		flex-shrink: 0;
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		background: transparent;
		cursor: pointer;
	}

	.meetings-row-action:hover {
		background: var(--color-surface-hover);
	}
</style>
