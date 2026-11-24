import type { MailboxView } from '$lib/types';

/** What a conversation's actions menu (its ⋯ button, or a right-click) offers. */
export type RowAction =
	| 'open'
	| 'openTab'
	| 'editDraft'
	| 'reply'
	| 'replyAll'
	| 'forward'
	| 'star'
	| 'unstar'
	| 'label'
	| 'archive'
	| 'unarchive'
	| 'read'
	| 'unread'
	| 'copySender'
	| 'withSender'
	| 'spam'
	| 'notspam'
	| 'trash'
	| 'restore'
	| 'delete';

/** Groups of actions, drawn with a divider between them. */
export type MenuSections = RowAction[][];

type RowState = { is_starred: boolean; is_read: boolean; is_draft: boolean };

/** Your own sent mail and drafts have no unread state to change. */
const hasReadState = (view: MailboxView, thread: RowState) => view !== 'sent' && !thread.is_draft;

/** Spam can be reported from anywhere mail arrives, and undone from Spam. */
function spamAction(view: MailboxView, thread: RowState): RowAction | null {
	if (view === 'spam') return 'notspam';
	if (view === 'sent' || view === 'drafts' || view === 'trash' || thread.is_draft) return null;
	return 'spam';
}

/** The read toggle, or nothing where there is no read state. */
function readAction(view: MailboxView, thread: RowState): RowAction | null {
	if (!hasReadState(view, thread)) return null;
	return thread.is_read ? 'unread' : 'read';
}

function binActions(view: MailboxView): RowAction[] {
	return view === 'trash' ? ['restore', 'delete'] : ['trash'];
}

function compact(sections: (RowAction | null)[][]): MenuSections {
	return sections
		.map((section) => section.filter((action): action is RowAction => action !== null))
		.filter((section) => section.length > 0);
}

/**
 * The menu for one conversation. `hasSender` is false when everyone in it is you,
 * so there is no one to copy or look up.
 */
export function rowMenu(view: MailboxView, thread: RowState, hasSender: boolean): MenuSections {
	const draft = thread.is_draft;
	return compact([
		draft ? ['editDraft'] : ['open', 'openTab'],
		draft ? [] : ['reply', 'replyAll', 'forward'],
		[
			thread.is_starred ? 'unstar' : 'star',
			'label',
			readAction(view, thread),
			view === 'archive' ? 'unarchive' : 'archive'
		],
		hasSender && !draft ? ['copySender', 'withSender'] : [],
		[spamAction(view, thread), ...binActions(view)]
	]);
}

/**
 * The menu for a selection of conversations: only what applies to all of them at once.
 * Star and read follow the majority need — any unstarred one makes it "Star".
 */
export function selectionMenu(view: MailboxView, threads: RowState[]): MenuSections {
	const anyUnstarred = threads.some((thread) => !thread.is_starred);
	const readable = threads.filter((thread) => hasReadState(view, thread));
	const anyUnread = readable.some((thread) => !thread.is_read);
	let read: RowAction | null = null;
	if (readable.length > 0) read = anyUnread ? 'read' : 'unread';
	const spam = threads.every((thread) => spamAction(view, thread) !== null) ? spamAction(view, threads[0]) : null;
	return compact([
		[
			anyUnstarred ? 'star' : 'unstar',
			read,
			view === 'archive' ? 'unarchive' : 'archive'
		],
		// Deleting for good asks about one message at a time, so a selection can only be restored.
		[spam, ...(view === 'trash' ? (['restore'] as const) : (['trash'] as const))]
	]);
}

/** Arrow keys, Home and End move through a menu, wrapping at the ends; any other key is not a move. */
export function menuStep(key: string, index: number, count: number): number | null {
	if (count === 0) return null;
	switch (key) {
		case 'ArrowDown':
			return (index + 1) % count;
		case 'ArrowUp':
			return (index - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}

type Box = { top: number; bottom: number; right: number };
type Size = { width: number; height: number };

/** Under the button and lined up with its right edge, or above it when there is no room below, always on screen. */
export function placeMenu(anchor: Box, menu: Size, viewport: Size, gap = 4, margin = 8): { left: number; top: number } {
	const left = Math.max(margin, Math.min(anchor.right - menu.width, viewport.width - menu.width - margin));
	const below = anchor.bottom + gap;
	const fitsBelow = below + menu.height <= viewport.height - margin;
	const top = fitsBelow ? below : Math.max(margin, anchor.top - gap - menu.height);
	return { left, top };
}

/**
 * At the pointer, like a desktop context menu: opening right and down, flipping
 * left or up where it would run off screen, and never past the margin.
 */
export function placeAtPoint(
	point: { x: number; y: number },
	menu: Size,
	viewport: Size,
	margin = 8
): { left: number; top: number } {
	const fitsRight = point.x + menu.width <= viewport.width - margin;
	const fitsBelow = point.y + menu.height <= viewport.height - margin;
	const left = fitsRight ? point.x : point.x - menu.width;
	const top = fitsBelow ? point.y : point.y - menu.height;
	return {
		left: Math.max(margin, Math.min(left, viewport.width - menu.width - margin)),
		top: Math.max(margin, Math.min(top, viewport.height - menu.height - margin))
	};
}
