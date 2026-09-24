import { invalidate } from '$app/navigation';
import { actOnInvitation, fetchInvitation } from './client';
import type { InvitationAction, InvitationView } from './invitations';

/**
 * The state behind an invitation card, shared by both themes' markup: load the
 * invitation a message carries, then answer it or add/remove it.
 */
export class InvitationCard {
	view = $state<InvitationView | null>(null);
	/** The action in flight, so only its button shows progress. */
	busy = $state<InvitationAction | null>(null);
	error = $state('');
	/** Set after an answer: whether it reached the organizer. */
	replied = $state<boolean | null>(null);

	constructor(private readonly emailId: string) {}

	async load() {
		try {
			this.view = await fetchInvitation(this.emailId);
		} catch {
			// A card that can't load just isn't shown; the message and its .ics are still there.
			this.view = null;
		}
	}

	async act(action: InvitationAction) {
		if (this.busy) return;
		this.busy = action;
		this.error = '';
		this.replied = null;
		try {
			const result = await actOnInvitation(this.emailId, action);
			this.view = result.invitation;
			if (this.view.canReply && action !== 'add' && action !== 'remove') this.replied = result.replied;
			await invalidate('app:calendar');
		} catch (error_) {
			this.error = error_ instanceof Error ? error_.message : String(error_);
		} finally {
			this.busy = null;
		}
	}
}
