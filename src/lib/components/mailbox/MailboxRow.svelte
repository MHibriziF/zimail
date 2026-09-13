<script lang="ts">
	import Icon from '../Icon.svelte';
	import Check from '../Check.svelte';
	import DeliveryStatus from './DeliveryStatus.svelte';
	import SwipeRow from './SwipeRow.svelte';
	import { formatRelativeDate } from '$lib/utils/date';
	import { t } from '$lib/i18n';
	import type { MailAddress, MailboxView, ThreadParticipant, ThreadSummary } from '$lib/types';

	let {
		thread,
		view,
		addresses,
		selected,
		selecting,
		onToggle,
		onToggleStar,
		onRun,
		onLinkClick,
		onPointerDown,
		onPointerUp,
		onPointerCancel,
		onPointerMove
	}: {
		thread: ThreadSummary;
		view: MailboxView;
		addresses: MailAddress[];
		selected: boolean;
		selecting: boolean;
		onToggle: () => void;
		onToggleStar: () => void;
		onRun: (action: string) => void;
		onLinkClick: (event: MouseEvent) => void;
		onPointerDown: (event: PointerEvent) => void;
		onPointerUp: () => void;
		onPointerCancel: () => void;
		onPointerMove: (event: PointerEvent) => void;
	} = $props();

	/** The identity a conversation arrived on — shown only when it disambiguates. */
	function identity(): MailAddress | null {
		if (addresses.length < 2) return null;
		// Catch-all deliveries have no address_id on purpose; do not guess from domain.
		return addresses.find((address) => address.id === thread.address_id) ?? null;
	}

	/**
	 * Who to show on the row. Sent and Drafts are about where a message went, so
	 * they name the recipient; everywhere else names the people in the thread.
	 */
	function people(): string {
		if (view === 'drafts' || (view === 'sent' && thread.participants.every((p) => p.self))) {
			return recipientOf() || (view === 'drafts' ? t('mailbox.noRecipient') : t('common.unknown'));
		}

		return thread.participants.map(participantLabel).join(', ');
	}

	function recipientOf(): string {
		const [first] = thread.participants;
		return first?.address ? localPartWords(first.address) : '';
	}

	/** "hello.there@x.com" → "hello there"; the row capitalizes it in CSS. */
	function localPartWords(address: string): string {
		return address.split('@')[0].replace(/[._-]+/g, ' ');
	}

	/**
	 * A participant with no known name falls back to their raw address — fine
	 * anywhere else, but this row runs every label through CSS
	 * `text-transform: capitalize`, and a full address survives that badly:
	 * "noreply@sifpi.my.id" becomes "Noreply@Sifpi.My.Id". Humanize the same
	 * fallback a nameless recipient already gets instead.
	 */
	function participantLabel(participant: ThreadParticipant): string {
		if (participant.self || participant.label !== participant.address) return participant.label;
		return localPartWords(participant.address);
	}

	function initial(): string {
		const external = thread.participants.find((participant) => !participant.self);
		return ((external ?? thread.participants[0])?.address[0] ?? '?').toUpperCase();
	}

	/** Rows carry the newest message; opening it opens the whole conversation. */
	function href(): string {
		return thread.is_draft ? `/compose?draft=${thread.latest_id}` : `/mail/${thread.latest_id}`;
	}

	function swipeLeftAction() {
		if (view === 'trash') return { icon: 'delete-bin-2-line', label: t('mailbox.delete'), tone: 'danger' as const };
		return { icon: 'delete-bin-line', label: t('nav.trash'), tone: 'danger' as const };
	}

	function swipeRightAction() {
		if (view === 'trash') return { icon: 'arrow-go-back-line', label: t('mailbox.restore'), tone: 'good' as const };
		return {
			icon: thread.is_starred ? 'star-fill' : 'star-line',
			label: thread.is_starred ? t('mailbox.unstar') : t('mailbox.star'),
			tone: 'star' as const
		};
	}

	function onSwipeLeft() {
		if (view === 'trash') onRun('delete');
		else onRun('trash');
	}

	function onSwipeRight() {
		if (view === 'trash') onRun('restore');
		else onToggleStar();
	}
</script>

<li class="row" class:unread={!thread.is_read} class:checked={selected}>
	<SwipeRow disabled={selecting} left={swipeRightAction()} right={swipeLeftAction()} onLeft={onSwipeRight} onRight={onSwipeLeft}>
		<Check label={`Select conversation with ${people()}`} checked={selected} onchange={onToggle} />

		<button
			type="button"
			class="star"
			class:on={thread.is_starred}
			aria-label={thread.is_starred ? t('mailbox.removeStar') : t('mailbox.addStar')}
			onclick={onToggleStar}
		>
			<Icon name={thread.is_starred ? 'star-fill' : 'star-line'} size={15} />
		</button>

		<a
			class="row-link"
			href={href()}
			onclick={onLinkClick}
			onpointerdown={onPointerDown}
			onpointerup={onPointerUp}
			onpointercancel={onPointerCancel}
			onpointermove={onPointerMove}
		>
			<span class="avatar">{initial()}</span>

			<span class="sender" title={people()}>
				<span class="sender-names">{people()}</span>
				{#if thread.message_count > 1}
					<span class="count">{thread.message_count}</span>
				{/if}
				{#if thread.is_draft}<span class="tag tag-draft">{t('mailbox.draftTag')}</span>{/if}
				{#if identity()}
					<span class="tag">{identity()?.label || identity()?.address}</span>
				{/if}
			</span>

			<span class="body">
				<span class="subject">{thread.subject || '(no subject)'}</span>
				{#if thread.preview}
					<span class="preview">— {thread.preview}</span>
				{/if}
			</span>

			<span class="indicators">
				{#if view === 'sent' && thread.status}
					<DeliveryStatus status={thread.status} />
				{/if}
				{#if thread.has_attachments}
					<Icon name="attachment-2" size={14} />
				{/if}
			</span>

			<span class="date">{formatRelativeDate(thread.created_at)}</span>
		</a>

		<span class="row-actions">
			{#if view === 'trash'}
				<button type="button" class="tool-btn" title={t('mailbox.restore')} onclick={() => onRun('restore')}>
					<Icon name="arrow-go-back-line" size={15} />
				</button>
				<button type="button" class="tool-btn danger" title={t('mailbox.deletePermanently')} onclick={() => onRun('delete')}>
					<Icon name="delete-bin-2-line" size={15} />
				</button>
			{:else}
				<button
					type="button"
					class="tool-btn"
					title={thread.is_read ? t('mailbox.markUnread') : t('mailbox.markRead')}
					onclick={() => onRun(thread.is_read ? 'unread' : 'read')}
				>
					<Icon name={thread.is_read ? 'mail-line' : 'mail-open-line'} size={15} />
				</button>
				{#if view === 'archive'}
					<button type="button" class="tool-btn" title={t('mailbox.moveToInbox')} onclick={() => onRun('unarchive')}>
						<Icon name="inbox-line" size={15} />
					</button>
				{:else if view !== 'drafts'}
					<button type="button" class="tool-btn" title={t('nav.archive')} onclick={() => onRun('archive')}>
						<Icon name="archive-line" size={15} />
					</button>
				{/if}
				<button type="button" class="tool-btn" title={t('mailbox.moveToTrash')} onclick={() => onRun('trash')}>
					<Icon name="delete-bin-line" size={15} />
				</button>
			{/if}
		</span>
	</SwipeRow>
</li>

<style>
	/* Read rows sit back a shade; unread ones stay bright and bold. */
	.row {
		position: relative;
		background: var(--color-bg);
		box-shadow: inset 0 -1px 0 var(--color-line);
		transition: background 0.12s;
	}

	.row:last-child {
		box-shadow: none;
	}

	.row :global(.swipe-content) {
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.875rem;
		background: var(--color-bg);
	}

	.row.unread :global(.swipe-content) {
		background: var(--color-surface);
	}

	.row:hover :global(.swipe-content),
	.row.unread:hover :global(.swipe-content) {
		background: var(--color-surface-muted);
	}

	.row.checked :global(.swipe-content),
	.row.checked:hover :global(.swipe-content) {
		background: var(--color-accent-soft);
	}

	.star {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		color: var(--color-muted);
		transition: color 0.12s;
	}

	.star:hover {
		color: var(--color-text);
	}

	.star.on {
		color: var(--color-star);
	}

	.row-link {
		display: grid;
		grid-template-columns: 2rem minmax(6rem, 11rem) minmax(0, 1fr) auto 4.5rem;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		padding: 0.625rem 0;
	}

	.avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
	}

	.row.unread .avatar {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.sender {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-transform: capitalize;
	}

	.row.unread .sender {
		font-weight: 600;
		color: var(--color-text);
	}

	.sender-names {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* How many messages the conversation holds. */
	.count {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--color-muted);
	}

	.row.unread .count {
		color: var(--color-text-secondary);
	}

	.body {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}

	.subject {
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row.unread .subject {
		font-weight: 600;
		color: var(--color-text);
	}

	.preview {
		flex: 1;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.indicators {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
		color: var(--color-muted);
	}

	.tag {
		padding: 0.125rem 0.4375rem;
		border-radius: 9999px;
		font-size: 0.625rem;
		font-weight: 500;
		color: var(--color-muted);
		background: var(--color-surface-hover);
		white-space: nowrap;
	}

	.tag-draft {
		color: var(--color-danger);
		background: rgba(185, 28, 28, 0.08);
	}

	.date {
		font-size: 0.75rem;
		color: var(--color-muted);
		text-align: right;
		white-space: nowrap;
	}

	.row.unread .date {
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.875rem;
		height: 1.875rem;
		border-radius: 0.5rem;
		color: var(--color-text-secondary);
		transition: background 0.15s, color 0.15s;
	}

	.tool-btn:hover:not(:disabled) {
		background: var(--color-surface-muted);
		color: var(--color-text);
	}

	.tool-btn.danger:hover {
		color: var(--color-danger);
	}

	.row-actions {
		position: absolute;
		top: 50%;
		right: 0.875rem;
		z-index: 5;
		display: none;
		align-items: center;
		gap: 0.125rem;
		padding-left: 1.5rem;
		transform: translateY(-50%);
		background: linear-gradient(to right, transparent, var(--color-surface-muted) 1.5rem);
	}

	.row:hover .row-actions {
		display: flex;
	}

	@media (max-width: 900px) {
		.row :global(.swipe-content) {
			grid-template-columns: auto 1fr;
			gap: 0.625rem;
			padding: 0.25rem 1rem;
			min-height: 4.5rem;
		}

		.star {
			display: none;
		}

		.row-link {
			grid-template-columns: 2.5rem minmax(0, 1fr) auto;
			grid-template-areas:
				'avatar sender date'
				'avatar body body';
			gap: 0.15rem 0.75rem;
			padding: 0.75rem 0;
		}

		.avatar {
			grid-area: avatar;
			align-self: center;
			width: 2.5rem;
			height: 2.5rem;
			font-size: 0.8125rem;
		}

		.indicators {
			display: none;
		}

		.sender {
			grid-area: sender;
			font-size: 0.9375rem;
		}

		.date {
			grid-area: date;
		}

		.body {
			grid-area: body;
		}

		.row-actions {
			display: none !important;
		}

		.tool-btn {
			width: var(--touch-target);
			height: var(--touch-target);
		}
	}
</style>
