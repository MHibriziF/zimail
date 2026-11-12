import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createSqliteD1 } from '../../__tests__/support/sqlite-d1';
import { getPreferencesService, preferencesServiceForDb } from '../index';

describe('getPreferencesService', () => {
	test('throws when the database is unavailable', () => {
		assert.throws(() => getPreferencesService(undefined), /Database unavailable/);
	});

	test('builds a working service from a platform-shaped object', async () => {
		const { db, sqlite } = createSqliteD1();
		sqlite.exec("INSERT INTO users (id, email, name, password_hash) VALUES ('u1', 'ada@example.com', 'Ada', 'hash')");
		const service = getPreferencesService({ env: { DB: db } } as unknown as App.Platform);
		assert.equal(await service.setLocale('u1', 'es'), 'es');
		assert.equal(await preferencesServiceForDb(db).getLocale('u1'), 'es');
	});
});
