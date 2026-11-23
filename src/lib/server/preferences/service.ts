import { DEFAULT_LOCALE, parseLocale, type Locale } from '$lib/i18n/locales';
import { DEFAULT_UI_THEME, isThemeId } from '$lib/ui-theme/ids';
import { parseAppearance, serializeAppearance, type Appearance } from '$lib/ui-theme/appearance';
import { cleanSignature } from '../util/signature-html';
import type { PreferencesRepository } from './repository';

export type PreferencesService = {
	getEmailSignature(userId: string): Promise<string>;
	/** Returns the signature as stored, after cleaning. */
	updateEmailSignature(userId: string, value: string): Promise<string>;
	/** The stored theme, or the default when nothing is stored or it is not a theme id we have. */
	getUiTheme(userId: string): Promise<string>;
	setUiTheme(userId: string, theme: string): Promise<string>;
	getLocale(userId: string): Promise<Locale>;
	/** Returns the locale as resolved: an unknown value falls back to the default. */
	setLocale(userId: string, locale: string): Promise<Locale>;
	/** What the shell needs for the first paint, each falling back like the single getters. */
	getShellPreferences(userId: string): Promise<ShellPreferences>;
	/** Saves what is valid of `value` (the rest falls back to the default) and returns it. */
	setAppearance(userId: string, value: unknown): Promise<Appearance>;
};

export type ShellPreferences = { uiTheme: string; locale: Locale; appearance: Appearance };

export function createPreferencesService(repo: PreferencesRepository): PreferencesService {
	return {
		getEmailSignature(userId) {
			return repo.getEmailSignature(userId);
		},
		async updateEmailSignature(userId, value) {
			const signature = await cleanSignature(value);
			await repo.setEmailSignature(userId, signature);
			return signature;
		},

		async getUiTheme(userId) {
			const theme = await repo.getUiTheme(userId);
			return isThemeId(theme) ? theme : DEFAULT_UI_THEME;
		},
		async setUiTheme(userId, theme) {
			// A shape check (lowercase, digits, hyphens), not the registered list: the route checks that.
			if (!isThemeId(theme)) {
				throw new Error('Unknown theme');
			}
			await repo.setUiTheme(userId, theme);
			return theme;
		},

		async getLocale(userId) {
			const locale = await repo.getLocale(userId);
			return parseLocale(locale ?? DEFAULT_LOCALE);
		},
		async setLocale(userId, locale) {
			const resolved = parseLocale(locale);
			await repo.setLocale(userId, resolved);
			return resolved;
		},

		async getShellPreferences(userId) {
			const row = await repo.getShellPreferences(userId);
			const theme = row?.ui_theme;
			return {
				uiTheme: isThemeId(theme) ? theme : DEFAULT_UI_THEME,
				locale: parseLocale(row?.locale ?? DEFAULT_LOCALE),
				appearance: parseAppearance(row?.ui_appearance)
			};
		},
		async setAppearance(userId, value) {
			const appearance = parseAppearance(value);
			await repo.setAppearance(userId, serializeAppearance(appearance));
			return appearance;
		}
	};
}
