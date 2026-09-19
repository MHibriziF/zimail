import type { MailCategory } from '../../mail/categories';

/**
 * Sorts inbound mail into inbox tabs with plain rules over standard headers —
 * no model, no third party, nothing leaving the Worker (issue #28). Anything
 * the rules aren't sure about stays in Primary: a newsletter wrongly shown in
 * Primary is a nuisance, a real person's mail hidden in a tab is a miss.
 */
export type ClassifyInput = {
	from: string;
	subject: string;
	/** Lower-cased header names; values as received. Missing headers are fine. */
	headers: Record<string, string | null | undefined>;
};

/** Domains whose mail is notifications from a social network. */
const SOCIAL_DOMAINS = [
	'facebookmail.com',
	'facebook.com',
	'instagram.com',
	'linkedin.com',
	'x.com',
	'twitter.com',
	'tiktok.com',
	'reddit.com',
	'redditmail.com',
	'discord.com',
	'pinterest.com',
	'quora.com',
	'threads.net',
	'snapchat.com',
	'tumblr.com',
	'mastodon.social',
	'bsky.app'
];

/** Hosted discussion lists — their mail is a forum even without List-Id. */
const FORUM_DOMAINS = ['googlegroups.com', 'groups.io', 'discoursemail.com', 'freelists.org'];

/** Headers bulk-mail platforms add to marketing sends. */
const MARKETING_HEADERS = ['x-mailchimp-campaign', 'x-campaign', 'x-campaignid', 'x-mc-user', 'x-sg-eid', 'x-mailgun-tag'];

/** Sender names that mean a mailing, matched as a whole word at the start (`news@`, `news.eu@`). */
const PROMOTION_LOCALS = [
	'news', 'newsletter', 'newsletters', 'marketing', 'promo', 'promos', 'promotion', 'promotions',
	'offer', 'offers', 'deal', 'deals', 'sale', 'sales', 'hello', 'info', 'shop', 'store'
];

/** Sender names that mean a machine, matched the same way. */
const AUTOMATED_LOCALS = [
	'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notification', 'notifications', 'alert', 'alerts',
	'update', 'updates', 'mailer-daemon', 'account', 'security', 'billing', 'receipt', 'receipts',
	'order', 'orders', 'support'
];

const TRANSACTIONAL_WORDS = new Set([
	'receipt', 'invoice', 'order', 'shipped', 'shipping', 'delivery', 'delivered', 'payment', 'statement',
	'verify', 'verification', 'confirm', 'password', 'signin', 'login', 'reset', 'booking', 'reservation'
]);
const TRANSACTIONAL_PHRASES = ['security alert', 'your account', 'sign in', 'sign-in'];

/** `news` matches `news@` and `news.eu@`, but not `newsom@`. */
function hasLocalPrefix(local: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => local === prefix || (local.startsWith(prefix) && '._+-'.includes(local[prefix.length])));
}

function isTransactionalSubject(subject: string): boolean {
	const lower = subject.toLowerCase();
	if (TRANSACTIONAL_PHRASES.some((phrase) => lower.includes(phrase))) return true;
	return lower.split(/[^a-z]+/).some((word) => TRANSACTIONAL_WORDS.has(word));
}

/** An address without an `@` has no domain, and all of it is the local part. */
function domainOf(address: string): string {
	const at = address.lastIndexOf('@');
	return at === -1 ? '' : address.slice(at + 1).trim().toLowerCase();
}

function localPartOf(address: string): string {
	const at = address.lastIndexOf('@');
	return (at === -1 ? address : address.slice(0, at)).trim().toLowerCase();
}

/** `mail.linkedin.com` matches `linkedin.com`, but `notlinkedin.com` doesn't. */
function onDomain(domain: string, list: readonly string[]): boolean {
	return list.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

function has(headers: ClassifyInput['headers'], name: string): boolean {
	return Boolean(headers[name]?.trim());
}

function isForum(domain: string, headers: ClassifyInput['headers']): boolean {
	return has(headers, 'list-id') || has(headers, 'list-post') || onDomain(domain, FORUM_DOMAINS);
}

function hasMarketingHeaders(headers: ClassifyInput['headers']): boolean {
	return MARKETING_HEADERS.some((name) => has(headers, name));
}

/** Sent to a list of recipients rather than written to you. */
function isBulk(headers: ClassifyInput['headers']): boolean {
	return (
		has(headers, 'list-unsubscribe') ||
		/^(bulk|list|junk)$/i.test(headers['precedence']?.trim() ?? '') ||
		hasMarketingHeaders(headers)
	);
}

function isAutomated(local: string, headers: ClassifyInput['headers']): boolean {
	const autoSubmitted = headers['auto-submitted']?.trim().toLowerCase();
	return Boolean(autoSubmitted && autoSubmitted !== 'no') || hasLocalPrefix(local, AUTOMATED_LOCALS);
}

export function classifyMail({ from, subject, headers }: ClassifyInput): MailCategory {
	const domain = domainOf(from);
	const local = localPartOf(from);
	const bulk = isBulk(headers);

	if (isForum(domain, headers)) return 'forums';
	if (onDomain(domain, SOCIAL_DOMAINS)) return 'social';
	if (bulk && (hasLocalPrefix(local, PROMOTION_LOCALS) || hasMarketingHeaders(headers))) return 'promotions';
	if (isAutomated(local, headers) || (bulk && isTransactionalSubject(subject))) return 'updates';
	// Bulk mail that isn't clearly transactional is still a mailing.
	return bulk ? 'promotions' : 'primary';
}

/** Every header the rules read — what an inbound path has to hand over. */
export const CLASSIFY_HEADERS = [
	'list-id',
	'list-post',
	'list-unsubscribe',
	'precedence',
	'auto-submitted',
	...MARKETING_HEADERS
] as const;

/** Picks the headers the rules need, whatever shape a provider hands them over in. */
export function pickClassifyHeaders(get: (name: string) => string | null | undefined): ClassifyInput['headers'] {
	return Object.fromEntries(CLASSIFY_HEADERS.map((name) => [name, get(name)]));
}
