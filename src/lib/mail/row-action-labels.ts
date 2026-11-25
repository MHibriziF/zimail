import { t } from '$lib/i18n';
import type { ThreadSummary } from '$lib/types';
import type { RowAction } from './row-actions';

/** The person a conversation is with: its first participant who isn't you. */
export const senderOf = (thread: ThreadSummary) => thread.participants.find((person) => !person.self) ?? null;

const LABELS: Record<Exclude<RowAction, 'withSender'>, string> = {
	open: 'common.open',
	openTab: 'mailbox.openInNewTab',
	editDraft: 'mailbox.editDraft',
	reply: 'thread.reply',
	replyAll: 'thread.replyAll',
	forward: 'thread.forward',
	star: 'mailbox.star',
	unstar: 'mailbox.unstar',
	label: 'labels.apply',
	archive: 'nav.archive',
	unarchive: 'mailbox.moveToInbox',
	read: 'mailbox.markRead',
	unread: 'mailbox.markUnread',
	copySender: 'mailbox.copySender',
	spam: 'thread.reportSpam',
	notspam: 'thread.notSpam',
	trash: 'nav.bin',
	restore: 'mailbox.restore',
	delete: 'mailbox.deletePermanently'
};

/**
 * What a row menu calls `action` for `thread` (the first of a selection).
 * `words` swaps in a theme's own message keys, such as Classic's "Move to trash" for Zero's "Bin".
 */
export function rowActionLabel(
	action: RowAction,
	thread: ThreadSummary | undefined,
	words: Partial<typeof LABELS> = {}
): string {
	if (action !== 'withSender') return t(words[action] ?? LABELS[action]);
	const person = thread ? senderOf(thread) : null;
	return t('mailbox.withSender', { name: person?.label || person?.address || '' });
}

/** Actions that destroy or bin mail, drawn in the danger colour. */
export const DANGER_ACTIONS: ReadonlySet<RowAction> = new Set<RowAction>(['trash', 'delete']);

/** The accessible name of a row menu: the conversation's subject, or how many are selected. */
export function rowMenuLabel(targets: ThreadSummary[]): string | undefined {
	if (targets.length > 1) return t('mailbox.selectionActions', { count: targets.length });
	const [only] = targets;
	return only ? t('mailbox.actionsFor', { subject: only.subject || t('mailbox.noSubject') }) : undefined;
}
