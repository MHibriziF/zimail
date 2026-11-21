import type { MailboxView } from '$lib/types';

/** What a conversation's actions menu offers, by the list it is in. */
export type RowAction = 'star' | 'unstar' | 'archive' | 'unarchive' | 'read' | 'unread' | 'trash' | 'restore' | 'delete';

export function rowActions(
	view: MailboxView,
	thread: { is_starred: boolean; is_read: boolean; is_draft: boolean }
): RowAction[] {
	const actions: RowAction[] = [thread.is_starred ? 'unstar' : 'star'];
	actions.push(view === 'archive' ? 'unarchive' : 'archive');
	// Your own sent mail and drafts have no unread state to change.
	if (view !== 'sent' && !thread.is_draft) actions.push(thread.is_read ? 'unread' : 'read');
	if (view === 'trash') actions.push('restore', 'delete');
	else actions.push('trash');
	return actions;
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
