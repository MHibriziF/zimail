import type { EmailRow } from '$lib/types';
import { stripTags } from '$lib/utils/text';
import { getMailStoreService } from '../mail-store';
import type { ThreadMessageRow } from '../mail-store/repository';
import type { FoundMessage } from './find';
import { createAiService, type AiService } from './service';

export { COMPOSE_ACTIONS, type ComposeAction } from './prompt';
export { MAX_QUESTION_CHARS, type FoundMessage, type HistoryTurn } from './find';
export { createAiService, type AiService, type ComposeOutcome, type FindOutcome } from './service';

type PlatformLike = App.Platform | undefined | null;

function sender(row: { from_addr: string; from_name: string | null }): string {
	return row.from_name ? `${row.from_name} <${row.from_addr}>` : row.from_addr;
}

function toFound(row: ThreadMessageRow | EmailRow, snippet: string, hasAttachments: boolean): FoundMessage {
	return {
		id: row.id,
		threadId: row.thread_id ?? row.id,
		direction: row.direction,
		from: sender(row),
		to: row.to_addr,
		subject: row.subject,
		createdAt: row.created_at,
		snippet,
		hasAttachments
	};
}

/** Composition root for routes. Works without the AI binding and reports `unavailable`. */
export function getAiService(platform: PlatformLike): AiService {
	const mailStore = getMailStoreService(platform);
	return createAiService({
		ai: platform?.env.AI ?? null,
		async searchMail(userId, args, limit) {
			const rows = await mailStore.searchMessages(
				userId,
				{
					view: args.view,
					terms: args.terms,
					from: args.from,
					after: args.after,
					before: args.before,
					unreadOnly: args.unreadOnly,
					attachmentsOnly: args.attachmentsOnly,
					anyTerm: args.anyTerm
				},
				limit
			);
			return rows.map((row) => toFound(row, row.body_head ?? '', Boolean(row.has_attachments)));
		},
		async readMessage(userId, emailId) {
			const email = await mailStore.getEmailForUser(userId, emailId);
			if (!email || email.status === 'draft') return null;
			const text = email.body_text?.trim() || stripTags(email.body_html ?? '');
			return { ...toFound(email, text.slice(0, 200), false), text };
		}
	});
}
