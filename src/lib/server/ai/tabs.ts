import { parseMailCategory, type MailCategory } from '../../mail/categories';
import { isDailyLimitError, type AiBinding } from './service';

/**
 * Clef is Cloudflare's own decision model, so mail sorted with it never leaves
 * the account. Flash matched the 27B model on the #153 test set at a third of
 * the cost.
 */
export const TAB_MODEL = '@cf/cloudflare/clef-flash';

/** Clef takes up to 64 questions a call; one question per message. */
export const TAB_CHUNK = 25;
const BODY_CHARS = 2_000;

export type TabMessage = {
	from: string;
	fromName?: string | null;
	subject: string;
	body?: string | null;
	headers?: Record<string, string | null | undefined>;
};

/** Gmail's tab definitions, with "needs attention now" spelled out for Primary. */
const TAB_CRITERIA: Record<MailCategory, string> = {
	primary:
		'Mail from people the recipient knows, replies and conversations, and automated mail that needs their attention now: sign-in links, verification and one-time codes, password resets, security alerts, someone replying to or mentioning them. Anything that fits no other tab.',
	social: 'Messages from social networks and media-sharing sites.',
	promotions:
		'Deals, offers, and other promotional mail meant to sell or market: sales, discounts, brand newsletters, product launches.',
	updates:
		'Automated confirmations, notifications, statements, and reminders that may not need immediate attention: receipts, invoices, order and shipping status, bills, account statements, reminders, service notices.',
	forums: 'Messages from online groups, discussion boards, and mailing lists.'
};

function presentHeaders(headers: TabMessage['headers']): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
	);
}

export function tabRequest(messages: TabMessage[]): Record<string, unknown> {
	const mail: Record<string, unknown> = {};
	const questions: Record<string, unknown> = {};
	messages.forEach((message, index) => {
		const slot = `m${index}`;
		mail[slot] = {
			from: message.from,
			fromName: message.fromName?.trim() || null,
			subject: message.subject,
			body: (message.body ?? '').slice(0, BODY_CHARS),
			headers: presentHeaders(message.headers)
		};
		questions[slot] = {
			type: 'choice',
			instructions: `Which inbox tab should the email in \`mail.${slot}\` live in?`,
			criteria: TAB_CRITERIA
		};
	});
	return { model: TAB_MODEL.slice(TAB_MODEL.lastIndexOf('/') + 1), state: { mail }, questions };
}

/** One tab per message, or `null` where Clef gave no usable answer. */
export function tabsFromResponse(response: unknown, count: number): (MailCategory | null)[] {
	const answers = (response as { answers?: Record<string, { choice?: unknown } | undefined> } | null)?.answers ?? {};
	return Array.from({ length: count }, (_, index) => parseMailCategory(answers[`m${index}`]?.choice) ?? null);
}

export type TabsOutcome =
	| { kind: 'sorted'; tabs: (MailCategory | null)[] }
	| { kind: 'limit_reached' }
	| { kind: 'failed' };

/** Sorts `messages` in calls of `TAB_CHUNK`. Never throws: callers fall back to the rules. */
export async function sortTabs(ai: AiBinding, messages: TabMessage[]): Promise<TabsOutcome> {
	const tabs: (MailCategory | null)[] = [];
	try {
		for (let start = 0; start < messages.length; start += TAB_CHUNK) {
			const chunk = messages.slice(start, start + TAB_CHUNK);
			tabs.push(...tabsFromResponse(await ai.run(TAB_MODEL, tabRequest(chunk)), chunk.length));
		}
	} catch (error) {
		if (isDailyLimitError(error)) return { kind: 'limit_reached' };
		console.error('AI tab sorting failed', error);
		return { kind: 'failed' };
	}
	return { kind: 'sorted', tabs };
}
