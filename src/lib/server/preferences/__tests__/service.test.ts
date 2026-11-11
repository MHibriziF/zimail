import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_LOCALE } from '$lib/i18n/locales';
import { DEFAULT_UI_THEME } from '$lib/ui-theme/ids';
import type { PreferencesRepository } from '../repository';
import { createPreferencesService } from '../service';

function fakeRepo() {
	const stored = { signature: '', theme: null as string | null, locale: null as string | null };
	const repo: PreferencesRepository = {
		async getEmailSignature() {
			return stored.signature;
		},
		async setEmailSignature(_userId, value) {
			stored.signature = value;
		},
		async getUiTheme() {
			return stored.theme;
		},
		async setUiTheme(_userId, theme) {
			stored.theme = theme;
		},
		async getLocale() {
			return stored.locale;
		},
		async setLocale(_userId, locale) {
			stored.locale = locale;
		}
	};
	return { repo, stored };
}

describe('preferences service', () => {
	test('updateEmailSignature cleans before saving and returns what was stored', async () => {
		const { repo } = fakeRepo();
		const service = createPreferencesService(repo);
		const saved = await service.updateEmailSignature('user-1', '  Cheers,\nAda  ');
		assert.equal(await service.getEmailSignature('user-1'), saved);
		assert.notEqual(saved, '  Cheers,\nAda  ');
	});

	test('getUiTheme falls back to the default when nothing, or nonsense, is stored', async () => {
		const { repo, stored } = fakeRepo();
		const service = createPreferencesService(repo);
		assert.equal(await service.getUiTheme('user-1'), DEFAULT_UI_THEME);
		stored.theme = 'Not A Theme!';
		assert.equal(await service.getUiTheme('user-1'), DEFAULT_UI_THEME);
	});

	test('setUiTheme saves a well-formed id and rejects a malformed one', async () => {
		// A shape check (lowercase, digits, hyphens), not the registered list; the route checks that.
		const { repo } = fakeRepo();
		const service = createPreferencesService(repo);
		assert.equal(await service.setUiTheme('user-1', 'zero-dark'), 'zero-dark');
		assert.equal(await service.getUiTheme('user-1'), 'zero-dark');
		await assert.rejects(service.setUiTheme('user-1', 'Not A Valid Theme!'), /Unknown theme/);
	});

	test('getLocale falls back to the default for an unset or unknown value', async () => {
		const { repo, stored } = fakeRepo();
		const service = createPreferencesService(repo);
		assert.equal(await service.getLocale('user-1'), DEFAULT_LOCALE);
		stored.locale = 'xx-YY';
		assert.equal(await service.getLocale('user-1'), DEFAULT_LOCALE);
	});

	test('setLocale resolves and saves the locale', async () => {
		const { repo } = fakeRepo();
		const service = createPreferencesService(repo);
		const saved = await service.setLocale('user-1', 'fr');
		assert.equal(saved, 'fr');
		assert.equal(await service.getLocale('user-1'), 'fr');
	});
});
