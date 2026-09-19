/** Inbox tabs, in display order. Primary is where anything unsorted lands. */
export const MAIL_CATEGORIES = ['primary', 'social', 'promotions', 'updates', 'forums'] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export function parseMailCategory(value: unknown): MailCategory | undefined {
	return MAIL_CATEGORIES.find((category) => category === value);
}
