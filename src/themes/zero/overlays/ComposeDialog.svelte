<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import RichTextEditor from '$lib/components/mailbox/RichTextEditor.svelte';
	import RecipientField from '$lib/components/mailbox/RecipientField.svelte';
	import Tooltip from '$lib/components/Tooltip.svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import { describeMailError, sendMessage } from '$lib/mail/client';
	import { meetingLinkHtml, startMeeting } from '$lib/mail/meetings';
	import type { MailAddress, OutboundAttachmentInput } from '$lib/types';
	import Icon from '../icons/Icon.svelte';
	import ComposerActions from './ComposerActions.svelte';
	import { t } from '$lib/i18n';

	let {
		addresses,
		draftId = null,
		onClose
	}: {
		addresses: MailAddress[];
		draftId?: string | null;
		onClose: () => void;
	} = $props();

	const defaultAddressId = $derived(
		addresses.find((address) => address.is_default)?.id ?? addresses[0]?.id ?? ''
	);
	let chosenAddressId = $state('');
	const fromAddressId = $derived(chosenAddressId || defaultAddressId);

	let activeDraft = $state<string | null>(null);
	let to = $state('');
	let cc = $state('');
	let bcc = $state('');
	let subject = $state('');
	let html = $state('');
	let attachments = $state<OutboundAttachmentInput[]>([]);
	let showCc = $state(false);
	let showBcc = $state(false);
	let error = $state('');
	let sending = $state(false);
	let savingDraft = $state(false);

	$effect(() => {
		activeDraft = draftId;
	});

	$effect(() => {
		const id = draftId;
		if (!id) return;
		void fetch(`/api/drafts/${id}`)
			.then(async (response) => {
				const draft = (await response.json()) as {
					id?: string;
					to_addr?: string;
					cc_addr?: string | null;
					bcc_addr?: string | null;
					subject?: string;
					body_html?: string | null;
					body_text?: string | null;
					address_id?: string | null;
					error?: string;
				};
				if (!response.ok || !draft.id) {
					error = draft.error ?? t('compose.couldNotLoadDraft');
					return;
				}
				activeDraft = draft.id;
				to = draft.to_addr ?? '';
				cc = draft.cc_addr ?? '';
				bcc = draft.bcc_addr ?? '';
				subject = draft.subject ?? '';
				html = draft.body_html || draft.body_text || '';
				if (draft.address_id) chosenAddressId = draft.address_id;
				showCc = Boolean(draft.cc_addr);
				showBcc = Boolean(draft.bcc_addr);
			})
			.catch(() => {
				error = t('compose.couldNotLoadDraft');
			});
	});

	const hasDraftText = $derived(Boolean(to.trim() || subject.trim() || !isHtmlEmpty(html)));
	let startingMeeting = $state(false);

	async function addMeetingLink() {
		if (startingMeeting) return;
		startingMeeting = true;
		error = '';

		try {
			const meeting = await startMeeting(subject.trim() || undefined);
			html += meetingLinkHtml(meeting.joinUrl, meeting.code);
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
		} finally {
			startingMeeting = false;
		}
	}

	async function saveDraft(): Promise<boolean> {
		if (savingDraft || !hasDraftText) return false;
		savingDraft = true;
		error = '';
		try {
			const response = await fetch('/api/drafts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: activeDraft,
					fromAddressId,
					to,
					cc: cc.trim() || undefined,
					bcc: bcc.trim() || undefined,
					subject,
					html,
					text: isHtmlEmpty(html) ? '' : htmlToPlainText(html)
				})
			});
			const body = (await response.json()) as { id?: string; error?: string };
			if (!response.ok) {
				error = body.error ?? t('compose.couldNotSaveDraft');
				return false;
			}
			activeDraft = body.id ?? activeDraft;
			return true;
		} catch {
			error = t('common.networkError');
			return false;
		} finally {
			savingDraft = false;
		}
	}

	function send(event: SubmitEvent) {
		event.preventDefault();
		return deliver(null);
	}

	/** Send now, or hand the message to the outbox for `scheduledAt`. */
	async function deliver(scheduledAt: string | null) {
		if (isHtmlEmpty(html)) {
			error = t('compose.writeMessage');
			return;
		}
		sending = true;
		error = '';
		try {
			await sendMessage({
				draftId: activeDraft,
				fromAddressId,
				to,
				cc,
				bcc,
				subject,
				html,
				text: htmlToPlainText(html),
				attachments,
				scheduledAt
			});
			await invalidateAll();
			onClose();
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
		} finally {
			sending = false;
		}
	}

	async function close() {
		if (hasDraftText) await saveDraft();
		onClose();
	}

	function onKey(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			(event.target as HTMLElement | null)?.closest('form')?.requestSubmit();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			void close();
		}
	}
</script>

<div class="z-overlay" onkeydown={onKey} role="dialog" aria-modal="true" tabindex="-1">
	<div class="z-compose-stage">
		<button type="button" class="z-esc" aria-label={t('common.close')} onclick={close}>
			<Icon name="X" size={14} />
			<span>esc</span>
		</button>

		<form class="z-composer" onsubmit={send}>
			<div class="z-composer-fields">
				<RecipientField
					id="z-to"
					shell="zero"
					label={t('compose.toColon')}
					bind:value={to}
					placeholder={t('compose.emailPlaceholder')}
					required
				>
					{#snippet trailing()}
						<div class="z-composer-row-actions">
							<button type="button" class="z-composer-link" onclick={() => (showCc = !showCc)}>{t('compose.cc')}</button>
							<button type="button" class="z-composer-link" onclick={() => (showBcc = !showBcc)}>{t('compose.bcc')}</button>
							<Tooltip text={t('common.close')}>
								<button type="button" class="z-composer-link" aria-label={t('common.close')} onclick={close}>
									<Icon name="X" size={14} />
								</button>
							</Tooltip>
						</div>
					{/snippet}
				</RecipientField>
				{#if showCc}
					<RecipientField
						id="z-cc"
						shell="zero"
						label={t('compose.ccColon')}
						bind:value={cc}
						placeholder={t('compose.ccPlaceholder')}
					/>
				{/if}
				{#if showBcc}
					<RecipientField
						id="z-bcc"
						shell="zero"
						label={t('compose.bccColon')}
						bind:value={bcc}
						placeholder={t('compose.bccPlaceholder')}
					/>
				{/if}
				<div class="z-composer-row">
						<span class="z-composer-label">{t('compose.subjectColon')}</span>
						<input class="z-composer-input" bind:value={subject} required placeholder={t('compose.subject')} />
				</div>
				{#if addresses.length > 1}
					<div class="z-composer-row">
						<span class="z-composer-label">{t('compose.fromColon')}</span>
						<select
							class="z-composer-input"
							value={fromAddressId}
							onchange={(event) => (chosenAddressId = event.currentTarget.value)}
						>
							{#each addresses as address (address.id)}
								<option value={address.id}>
									{address.label ? `${address.label} · ${address.address}` : address.address}
								</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>

			<div class="z-composer-body">
				<RichTextEditor bind:html embedded minHeight={200} placeholder={t('compose.writeMessagePlaceholder')} />
			</div>

			<ComposerActions
				bind:attachments
				sending={sending}
				error={error}
				timeZone={($page.data.timeZone as string | null | undefined) ?? null}
				onschedule={(iso) => void deliver(iso)}
			>
				{#snippet extra()}
					<button
						type="button"
						class="z-text-btn"
						onclick={addMeetingLink}
						disabled={startingMeeting}
					>
						{t('compose.startMeeting')}
					</button>
					<button
						type="button"
						class="z-text-btn"
						onclick={saveDraft}
						disabled={savingDraft || !hasDraftText}
					>
						{savingDraft ? t('common.saving') : t('compose.saveDraft')}
					</button>
				{/snippet}
			</ComposerActions>
		</form>
	</div>
</div>
