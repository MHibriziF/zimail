import type { D1Database } from '@cloudflare/workers-types';

/** Per-user preferences: columns on `users`, but nothing to do with signing in. */
export type PreferencesRepository = {
	getEmailSignature(userId: string): Promise<string>;
	setEmailSignature(userId: string, value: string): Promise<void>;
	getUiTheme(userId: string): Promise<string | null>;
	setUiTheme(userId: string, theme: string): Promise<void>;
	getLocale(userId: string): Promise<string | null>;
	setLocale(userId: string, locale: string): Promise<void>;
};

export function createD1PreferencesRepository(db: D1Database): PreferencesRepository {
	return {
		async getEmailSignature(userId) {
			const row = await db
				.prepare('SELECT email_signature FROM users WHERE id = ?')
				.bind(userId)
				.first<{ email_signature: string | null }>();
			return row?.email_signature ?? '';
		},

		async setEmailSignature(userId, value) {
			await db.prepare('UPDATE users SET email_signature = ? WHERE id = ?').bind(value, userId).run();
		},

		async getUiTheme(userId) {
			const row = await db
				.prepare('SELECT ui_theme FROM users WHERE id = ?')
				.bind(userId)
				.first<{ ui_theme: string | null }>();
			return row?.ui_theme ?? null;
		},

		async setUiTheme(userId, theme) {
			await db.prepare('UPDATE users SET ui_theme = ? WHERE id = ?').bind(theme, userId).run();
		},

		async getLocale(userId) {
			const row = await db
				.prepare('SELECT locale FROM users WHERE id = ?')
				.bind(userId)
				.first<{ locale: string | null }>();
			return row?.locale ?? null;
		},

		async setLocale(userId, locale) {
			await db.prepare('UPDATE users SET locale = ? WHERE id = ?').bind(locale, userId).run();
		}
	};
}
