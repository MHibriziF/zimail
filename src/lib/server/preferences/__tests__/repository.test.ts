import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createSqliteD1 } from '../../__tests__/support/sqlite-d1';
import { createD1PreferencesRepository } from '../repository';

function setup() {
	const { db, sqlite } = createSqliteD1();
	sqlite.exec("INSERT INTO users (id, email, name, password_hash) VALUES ('u1', 'ada@example.com', 'Ada', 'hash')");
	return { repo: createD1PreferencesRepository(db), sqlite };
}

describe('PreferencesRepository', () => {
	test('a fresh account carries the column defaults', async () => {
		// The schema fills these in, so the service only sees `null` for a row that
		// predates the columns (or does not exist); its fallbacks cover that case.
		const { repo } = setup();
		assert.equal(await repo.getEmailSignature('u1'), '');
		assert.equal(await repo.getUiTheme('u1'), 'classic');
		assert.equal(await repo.getLocale('u1'), 'en');
	});

	test('email signature, ui theme and locale round-trip', async () => {
		const { repo } = setup();
		await repo.setEmailSignature('u1', 'Cheers');
		assert.equal(await repo.getEmailSignature('u1'), 'Cheers');

		await repo.setUiTheme('u1', 'zero');
		assert.equal(await repo.getUiTheme('u1'), 'zero');

		await repo.setLocale('u1', 'fr');
		assert.equal(await repo.getLocale('u1'), 'fr');
	});

	test('an unknown user reads as unset and is not created by a write', async () => {
		const { repo, sqlite } = setup();
		assert.equal(await repo.getEmailSignature('nobody'), '');
		await repo.setLocale('nobody', 'fr');
		assert.equal(sqlite.prepare('SELECT count(*) AS n FROM users').get()?.n, 1);
	});
});
