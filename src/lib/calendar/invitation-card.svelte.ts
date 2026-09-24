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
		} catch (failure) {
			this.error = failure instanceof Error ? failure.message : String(failure);
		} finally {
			this.busy = null;
		}
	}
}

/** "Fri, Sep 25 · 10:30 – 11:00" in the reader's zone; all-day events as dates. */
export function formatInvitationWhen(view: InvitationView, locale: string, timeZone: string): string {
	const start = new Date(view.start);
	const end = new Date(view.end);
	if (view.allDay) {
		const date = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
		const last = new Date(end.getTime() - 86_400_000);
		return last.getTime() > start.getTime() ? `${date.format(start)} – ${date.format(last)}` : date.format(start);
	}
	const day = new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone });
	const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
	const sameDay = day.format(start) === day.format(end);
	return sameDay
		? `${day.format(start)} · ${time.format(start)} – ${time.format(end)}`
		: `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}`;
}
