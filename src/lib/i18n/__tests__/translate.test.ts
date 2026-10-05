import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	LOCALES,
	localeFromAcceptLanguage,
	localeShortLabel,
	matchLocale,
	parseLocale
} from '../locales';
import { translate } from '../translate';

test('matches zh variants to Simplified Chinese', () => {
	assert.equal(matchLocale('zh'), 'zh-CN');
	assert.equal(matchLocale('zh-Hans'), 'zh-CN');
	assert.equal(matchLocale('zh_CN'), 'zh-CN');
	assert.equal(parseLocale('nope'), 'en');
});

test('short labels stay two-letter codes', () => {
	assert.equal(localeShortLabel('en'), 'EN');
	assert.equal(localeShortLabel('fr'), 'FR');
	assert.equal(localeShortLabel('zh-CN'), 'ZH');
	assert.equal(localeShortLabel('es'), 'ES');
});

test('reads Accept-Language quality values', () => {
	assert.equal(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8'), 'fr');
	assert.equal(localeFromAcceptLanguage('es-MX,es;q=0.9'), 'es');
	assert.equal(localeFromAcceptLanguage(null), 'en');
});

test('interpolates params and returns unknown keys as-is', () => {
	assert.equal(translate('en', 'nav.inbox'), 'Inbox');
	assert.equal(translate('en', 'common.savedAt', { time: '3:01 PM' }), 'Saved 3:01 PM');
	assert.equal(translate('en', 'not.a.real.key'), 'not.a.real.key');
});

test('loads translated catalogs for starter locales', () => {
	assert.equal(translate('fr', 'nav.inbox'), 'Boîte de réception');
	assert.equal(translate('zh-CN', 'nav.inbox'), '收件箱');
	assert.equal(translate('es', 'nav.inbox'), 'Bandeja de entrada');
	assert.equal(translate('fr', 'common.savedAt', { time: '15:01' }), 'Enregistré 15:01');
});

function flattenKeys(tree: Record<string, unknown>, prefix = ''): string[] {
	const keys: string[] = [];
	for (const [name, value] of Object.entries(tree)) {
		const key = prefix ? `${prefix}.${name}` : name;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			keys.push(...flattenKeys(value as Record<string, unknown>, key));
		} else {
			keys.push(key);
		}
	}
	return keys;
}

test('locale catalogs expose the same keys as English', async () => {
	const en = (await import('../../../../messages/en.json')).default as Record<string, unknown>;
	const expected = flattenKeys(en).sort();
	for (const locale of ['fr', 'zh-CN', 'es'] as const) {
		const catalog = (await import(`../../../../messages/${locale}.json`)).default as Record<
			string,
			unknown
		>;
		assert.deepEqual(flattenKeys(catalog).sort(), expected, locale);
	}
});

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
		return /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
	});
}

test('every literal key the code translates exists in English', () => {
	// An unknown key renders as itself, so a string filed under the wrong
	// section shows up as `meet.captionsSettingLabel` in the UI (#171).
	const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
	const english = new Set(
		flattenKeys(JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8')) as Record<string, unknown>)
	);
	const missing: string[] = [];
	for (const file of sourceFiles(join(root, 'src'))) {
		for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z]+(?:\.[a-zA-Z0-9]+)+)'/g)) {
			if (!english.has(match[1])) missing.push(`${match[1]} (${file.slice(root.length + 1)})`);
		}
	}
	assert.deepEqual(missing, []);
});

test('every catalog has the same keys and placeholders as English', () => {
	// A missing key silently falls back to English, so nothing breaks — it just
	// leaves a stray English string in a translated UI. A dropped or renamed
	// placeholder is worse: it renders as a literal `{name}`.
	const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
	const load = (locale: string) =>
		JSON.parse(readFileSync(join(root, `messages/${locale}.json`), 'utf8')) as Record<
			string,
			unknown
		>;

	const flatten = (tree: Record<string, unknown>, prefix = ''): [string, string][] =>
		Object.entries(tree).flatMap(([key, value]) =>
			typeof value === 'string'
				? ([[prefix + key, value]] as [string, string][])
				: flatten(value as Record<string, unknown>, `${prefix}${key}.`)
		);

	const placeholders = (value: string) =>
		[...value.matchAll(/\{(\w+)\}/g)]
			.map((match) => match[1])
			.sort()
			.join(',');

	const english = new Map(flatten(load('en')));

	for (const locale of LOCALES) {
		if (locale === 'en') continue;
		const catalog = new Map(flatten(load(locale)));

		for (const [key, value] of english) {
			assert.ok(catalog.has(key), `${locale} is missing ${key}`);
			assert.equal(
				placeholders(catalog.get(key) ?? ''),
				placeholders(value),
				`${locale} ${key} placeholders differ`
			);
		}
		for (const key of catalog.keys()) {
			assert.ok(english.has(key), `${locale} has ${key}, which English does not`);
		}
	}
});
