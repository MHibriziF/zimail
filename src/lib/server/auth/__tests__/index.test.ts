import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { D1Database } from '@cloudflare/workers-types';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { getAuthService, getUserById } from '../index';

function fakeDb(handlers: Partial<Record<string, unknown[]>> = {}): D1Database {
	return createFakeD1(({ sql }) => {
		for (const [needle, result] of Object.entries(handlers)) {
			if (sql.includes(needle)) return result ?? [];
		}
		return [];
	});
}

describe('getAuthService', () => {
	test('throws when the database is unavailable', () => {
		assert.throws(() => getAuthService(undefined), /Database unavailable/);
	});

	test('builds a working service from a platform-shaped object', async () => {
		const platform = { env: { DB: fakeDb() } } as unknown as App.Platform;
		const service = getAuthService(platform);
		assert.equal(await service.countUsers(), 0);
	});
});

describe('legacy db-first facade', () => {
	test('getUserById delegates to the repository', async () => {
		const db = fakeDb({
			'FROM users WHERE id': [
				{ id: 'u1', email: 'ada@example.com', name: 'Ada', is_admin: 0, must_change_password: 0, created_at: 't' }
			]
		});
		const found = await getUserById(db, 'u1');
		assert.equal(found?.name, 'Ada');
	});
});
