<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import RichTextEditor from '$lib/components/mailbox/RichTextEditor.svelte';
	import AiAssist from '$lib/components/mailbox/AiAssist.svelte';
	import RecipientField from '$lib/components/mailbox/RecipientField.svelte';
	import { untrack } from 'svelte';
	import { htmlToPlainText, isHtmlEmpty } from '$lib/utils/html';
	import { composerBody, hasSignatureBlock } from '$lib/email-signature';
	import { isBodyEmpty, signatureFor, swapSignature } from '$lib/mail/signature';
	import { describeMailError, sendMessage, type SendMessageInput, mailWrite } from '$lib/mail/client';
	import { holdSend, peekRestored, settleRestored } from '$lib/mail/undo-send';
	import { meetingLinkHtml, startMeeting } from '$lib/mail/meetings';
	import type { MailAddress, OutboundAttachmentInput, User } from '$lib/types';
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
	type Snapshot = {
		draftId: string | null;
		chosenAddressId: string;
		to: string;
		cc: string;
		bcc: string;
		subject: string;
		html: string;
		attachments: OutboundAttachmentInput[];
	};

	// A message taken back with Undo comes back as it was sent, ahead of any saved draft.
	const restored = peekRestored<Snapshot>('compose');
	$effect(() => settleRestored('compose'));
	const back = restored?.snapshot;

	let chosenAddressId = $state(back?.chosenAddressId ?? '');
	const fromAddressId = $derived(chosenAddressId || defaultAddressId);

	let activeDraft = $state<string | null>(back?.draftId ?? null);
	let to = $state(back?.to ?? '');
	let cc = $state(back?.cc ?? '');
	let bcc = $state(back?.bcc ?? '');
	let subject = $state(back?.subject ?? '');
	const accountSignature = $derived(($page.data.user as User | null | undefined)?.email_signature);
	const signatureOf = (addressId: string) =>
		signatureFor(addresses.find((address) => address.id === addressId), accountSignature);

	/** The signature shows from the start, so nobody types a second one by hand. */
	function withSignature(body: string): string {
		return hasSignatureBlock(body) ? body : composerBody(signatureOf(fromAddressId), body);
	}

	let html = $state(back?.html ?? untrack(() => withSignature('')));

	function chooseFrom(addressId: string) {
		chosenAddressId = addressId;
		html = swapSignature(html, signatureOf(fromAddressId));
	}
	let attachments = $state<OutboundAttachmentInput[]>(back?.attachments ?? []);
	let showCc = $state(Boolean(back?.cc));
	let showBcc = $state(Boolean(back?.bcc));
	let error = $state(restored?.error ?? '');
	let sending = $state(false);
	let savingDraft = $state(false);

	$effect(() => {
		if (!back) activeDraft = draftId;
	});

	$effect(() => {
		const id = draftId;
		if (!id || back) return;
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
				if (draft.address_id) chosenAddressId = draft.address_id;
				html = untrack(() => withSignature(draft.body_html || draft.body_text || ''));
				showCc = Boolean(draft.cc_addr);
				showBcc = Boolean(draft.bcc_addr);
			})
			.catch(() => {
				error = t('compose.couldNotLoadDraft');
			});
	});

	const hasDraftText = $derived(Boolean(to.trim() || subject.trim() || !isBodyEmpty(html)));
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
			const response = await mailWrite('/api/drafts', {
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
			unsavedOnClose = false;
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
		if (isBodyEmpty(html)) {
			error = t('compose.writeMessage');
			return;
		}
		const message: SendMessageInput = {
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
		};
		if (!scheduledAt) {
			const reopenAt = `${$page.url.pathname}${$page.url.search}`;
			holdSend<Snapshot>({
				key: 'compose',
				snapshot: { draftId: activeDraft, chosenAddressId, to, cc, bcc, subject, html, attachments },
				send: async () => {
					const sent = await sendMessage(message);
					await invalidateAll();
					return sent.id ? `/sent?thread=${encodeURIComponent(sent.id)}` : '/sent';
				},
				reopen: () => void goto(reopenAt, { keepFocus: true, noScroll: true }),
				describeError: (failure) => describeMailError(failure, t('common.networkError'))
			});
			onClose();
			return;
		}
		sending = true;
		error = '';
		try {
			await sendMessage(message);
			await invalidateAll();
			onClose();
		} catch (failure) {
			error = describeMailError(failure, t('common.networkError'));
		} finally {
			sending = false;
		}
	}

	/** Set when closing could not save the draft, so the dialog stays open instead of losing what was typed. */
	let unsavedOnClose = $state(false);

	async function close() {
		if (hasDraftText && !(await saveDraft()) && error) {
			unsavedOnClose = true;
			return;
		}
		onClose();
	}

	let overlay = $state<HTMLDivElement | undefined>();

	const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, [contenteditable="true"], a[href]';

	/** Start in the first field, as a dialog should, rather than leaving focus on the page behind. */
	$effect(() => {
		if (!overlay) return;
		const first = overlay.querySelector<HTMLElement>('.z-composer input');
		first?.focus();
	});

	/** Tab stays in the dialog: past the last control it comes back to the first. */
	function wrapTab(event: KeyboardEvent) {
		if (!overlay) return;
		const items = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
		if (items.length === 0) return;
		const first = items[0];
		const last = items.at(-1) as HTMLElement;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Tab') wrapTab(event);
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

<div class="z-overlay" bind:this={overlay} onkeydown={onKey} role="dialog" aria-modal="true" aria-label={t('nav.newMessage')} tabindex="-1">
	<div class="z-compose-stage">
		<button type="button" class="z-esc" aria-label={t('common.close')} onclick={close}>
			<Icon name="X" size={14} />
			<span class="z-esc-key">esc</span>
		</button>

		{#if unsavedOnClose}
			<div class="z-unsaved" role="alert">
				<p>{t('compose.unsavedOnClose')}</p>
				<button type="button" class="z-text-btn" onclick={() => void close()}>{t('common.tryAgain')}</button>
				<button type="button" class="z-text-btn danger" onclick={onClose}>{t('compose.closeWithoutSaving')}</button>
			</div>
		{/if}

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
						<label class="z-composer-label" for="z-subject">{t('compose.subjectColon')}</label>
						<input id="z-subject" class="z-composer-input" bind:value={subject} required placeholder={t('compose.subject')} />
				</div>
				{#if addresses.length > 1}
					<div class="z-composer-row">
						<label class="z-composer-label" for="z-from">{t('compose.fromColon')}</label>
						<select
							id="z-from"
							class="z-composer-input"
							value={fromAddressId}
							onchange={(event) => chooseFrom(event.currentTarget.value)}
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
					<AiAssist bind:html bind:subject shell="zero" placement="up" />
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
