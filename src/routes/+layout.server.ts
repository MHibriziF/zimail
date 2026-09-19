import type { LayoutServerLoad } from './$types';
import { getMailStoreService } from '$lib/server/mail-store';
import { getLabelsService } from '$lib/server/labels';
import { runDueTrashPurge } from '$lib/server/cleanup';
import { getEmailProvider } from '$lib/server/context';
import { runDueScheduledSends } from '$lib/server/scheduled-send';
import { DEFAULT_UI_THEME } from '$lib/ui-theme/ids';
import { DEFAULT_LOCALE } from '$lib/i18n/locales';
import type { MailboxCounts } from '$lib/types';

const EMPTY_COUNTS: MailboxCounts = {
	inbox: 0,
	inbox_unread: 0,
	archive: 0,
	starred: 0,
	drafts: 0,
	sent: 0,
	trash: 0
};

export const load: LayoutServerLoad = async ({ locals, platform, depends }) => {
	const db = platform?.env.DB;

	// Reading a thread changes these, but that happens in another route's load,
	// which gives SvelteKit no reason to re-run this one. Naming the dependency
	// lets those routes refresh the badges without a full invalidateAll().
	depends('app:counts');
	depends('app:labels');

	// Emptying old trash rides along with a page load rather than a timer. The
	// claim inside is throttled to once a day, so this is a single cheap UPDATE
	// on all but one request in twenty-four hours.
	if (db && locals.user) {
		try {
			await runDueTrashPurge(db, platform?.env.ATTACHMENTS, locals.user.id);
		} catch {
			// Never block the mailbox on housekeeping.
		}
	}

	// The cron trigger is what normally sends scheduled mail, but `vite dev`
	// never runs the Worker and so never fires it. Sweeping this user's own due
	// messages on load keeps scheduling working in development, and is a cheap
	// no-op in production where the trigger has already been round.
	const bucket = platform?.env.ATTACHMENTS;
	if (db && bucket && locals.user) {
		try {
			await runDueScheduledSends({ DB: db, ATTACHMENTS: bucket }, getEmailProvider(platform), {
				userId: locals.user.id
			});
		} catch {
			// A message that cannot go out records its own failure; the mailbox
			// still has to load.
		}
	}

	// The sidebar shows these on every page, so they load with the shell.
	const counts =
		db && locals.user
			? await getMailStoreService(platform).getMailboxCounts(locals.user.id, locals.activeDomainId)
			: EMPTY_COUNTS;

	const timezoneRow =
		db && locals.user
			? await db
					.prepare('SELECT timezone FROM users WHERE id = ?')
					.bind(locals.user.id)
					.first<{ timezone: string | null }>()
			: null;

	// Sidebar label list — changes only when labels are managed, so it has its own dependency.
	const labels = db && locals.user ? await getLabelsService(platform).list(locals.user.id) : [];

	return {
		user: locals.user,
		labels,
		timeZone: timezoneRow?.timezone ?? null,
		domains: locals.domains,
		addresses: locals.addresses,
		activeDomainId: locals.activeDomainId,
		counts,
		uiTheme: locals.uiTheme ?? DEFAULT_UI_THEME,
		locale: locals.locale ?? DEFAULT_LOCALE
	};
};
