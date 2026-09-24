import { invalidate } from '$app/navigation';
import { actOnAnswer, actOnInvitation, fetchInvitation } from './client';
import type { AnswerAction, GuestAnswerView, InvitationAction, InvitationView } from './invitations';

/**
 * The state behind an invitation card, shared by both themes' markup: load the
 * calendar part a message carries, then act on it — answer or add/remove an
 * invitation, or accept/decline a guest's proposed time.
 */
export class InvitationCard {
	view = $state<InvitationView | null>(null);
	answer = $state<GuestAnswerView | null>(null);
	/** The action in flight, so only its button shows progress. */
	busy = $state<InvitationAction | AnswerAction | null>(null);
	error = $state('');
	/** Set after an answer: whether it reached the organizer. */
	replied = $state<boolean | null>(null);
	/** Set after turning a proposed time down. */
	proposalDeclined = $state(false);

	constructor(private readonly emailId: string) {}

	async load() {
		try {
			const loaded = await fetchInvitation(this.emailId);
			this.view = loaded.invitation;
			this.answer = loaded.answer;
		} catch {
			// A card that can't load just isn't shown; the message and its .ics are still there.
			this.view = null;
			this.answer = null;
		}
	}

	private async run(action: InvitationAction | AnswerAction, work: () => Promise<void>) {
		if (this.busy) return;
		this.busy = action;
		this.error = '';
		try {
			await work();
			await invalidate('app:calendar');
		} catch (error_) {
			this.error = error_ instanceof Error ? error_.message : String(error_);
		} finally {
			this.busy = null;
		}
	}

	act(action: InvitationAction) {
		this.replied = null;
		return this.run(action, async () => {
			const result = await actOnInvitation(this.emailId, action);
			this.view = result.invitation;
			if (this.view.canReply && action !== 'add' && action !== 'remove') this.replied = result.replied;
		});
	}

	settleProposal(action: AnswerAction) {
		return this.run(action, async () => {
			this.answer = await actOnAnswer(this.emailId, action);
			this.proposalDeclined = action === 'decline-proposal';
		});
	}
}
