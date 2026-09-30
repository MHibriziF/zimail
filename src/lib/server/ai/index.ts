import { stripTags } from '$lib/utils/text';
import { getMailStoreService } from '../mail-store';
import { createAiService, type AiService } from './service';

export { COMPOSE_ACTIONS, type ComposeAction } from './prompt';
export { createAiService, type AiService, type ComposeOutcome } from './service';

type PlatformLike = App.Platform | undefined | null;

/** Composition root for routes. Works without the AI binding and reports `unavailable`. */
export function getAiService(platform: PlatformLike): AiService {
	const mailStore = getMailStoreService(platform);
	return createAiService({
		ai: platform?.env.AI ?? null,
		async loadReplySource(userId, emailId) {
			const email = await mailStore.getEmailForUser(userId, emailId);
			if (!email) return null;
			return {
				from: email.from_name ? `${email.from_name} <${email.from_addr}>` : email.from_addr,
				subject: email.subject,
				text: email.body_text?.trim() || stripTags(email.body_html ?? '')
			};
		}
	});
}
