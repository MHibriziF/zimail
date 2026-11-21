/**
 * Opening a conversation from the list adds a history entry, so Back (or a
 * phone's back gesture) returns to the list as it was, and Forward reopens the
 * conversation. Moving from one conversation to another replaces the entry,
 * so reading ten messages doesn't take ten Backs to leave.
 */
export function openThreadNavigation(
	openThread: string | null,
	state: App.PageState
): { replaceState: boolean; state: App.PageState } {
	return openThread ? { replaceState: true, state } : { replaceState: false, state: { fromList: true } };
}

/** Closing goes Back only when the entry before is the list it was opened from, not when it arrived by a link. */
export function closeThreadGoesBack(state: App.PageState): boolean {
	return state.fromList === true;
}
