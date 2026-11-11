import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPendingMigrations, listMigrations } from '../../migrations/migrate';
import { createD1AdmissionsRepository } from '../../meet/admissions/repository';
import { createFsBucket } from '../fs-bucket';
import { createNodePlatform } from '../node-platform';

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'zimail-'));
	dirs.push(dir);
	return dir;
}
after(() => {
	for (const dir of dirs) {
		try {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		} catch {
			// Windows can hold the SQLite file a moment after close; a leftover temp folder is harmless.
		}
	}
});

describe('createFsBucket', () => {
	test('stores, reads back and deletes bytes under nested keys', async () => {
		const bucket = createFsBucket(tempDir());
		await bucket.put('email-1/att-1/report.pdf', new Uint8Array([1, 2, 3]));

		const object = await bucket.get('email-1/att-1/report.pdf');
		assert.ok(object);
		assert.equal(object.size, 3);
		assert.match(object.httpEtag, /^".+"$/);
		assert.deepEqual(new Uint8Array(await object.arrayBuffer()), new Uint8Array([1, 2, 3]));
		assert.deepEqual(new Uint8Array(await new Response(object.body as unknown as ReadableStream).arrayBuffer()), new Uint8Array([1, 2, 3]));

		await bucket.delete('email-1/att-1/report.pdf');
		assert.equal(await bucket.get('email-1/att-1/report.pdf'), null);
	});

	test('a missing key is null, and deleting it is not an error', async () => {
		const bucket = createFsBucket(tempDir());
		assert.equal(await bucket.get('nothing-here'), null);
		await bucket.delete(['nothing-here', 'nor-here']);
	});

	test('a key cannot leave the folder', async () => {
		const bucket = createFsBucket(tempDir());
		await assert.rejects(bucket.put('../outside', 'x'), /Invalid storage key/);
		await assert.rejects(bucket.get('a/../../outside'), /Invalid storage key/);
	});
});

describe('createNodePlatform', () => {
	test('migrates a fresh data folder, and a second start has nothing to do', async () => {
		const dataDir = tempDir();
		const first = createNodePlatform({ dataDir, vars: {} });
		const ran = await applyPendingMigrations(first.env.DB);
		assert.equal(ran.length > 0, true);
		assert.ok(ran.includes(listMigrations().filter((m) => !m.archived).at(-1)!.name));
		first.close();

		const second = createNodePlatform({ dataDir, vars: {} });
		assert.deepEqual(await applyPendingMigrations(second.env.DB), []);
		second.close();
	});

	test('enforces foreign keys, as D1 does', async () => {
		const platform = createNodePlatform({ dataDir: tempDir(), vars: {} });
		await applyPendingMigrations(platform.env.DB);
		await assert.rejects(
			createD1AdmissionsRepository(platform.env.DB).create('no-such-meeting', 'Ada'),
			/FOREIGN KEY constraint failed/
		);
		platform.close();
	});

	test('passes settings through and logs, rather than throws, a failed background task', async () => {
		const platform = createNodePlatform({ dataDir: tempDir(), vars: { EMAIL_PROVIDER: 'resend' } });
		assert.equal(platform.env.EMAIL_PROVIDER, 'resend');

		const logged: unknown[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => logged.push(args);
		try {
			platform.ctx.waitUntil(Promise.reject(new Error('boom')));
			await new Promise((resolve) => setTimeout(resolve, 0));
		} finally {
			console.error = original;
		}
		assert.equal(logged.length, 1);
		platform.close();
	});
});
