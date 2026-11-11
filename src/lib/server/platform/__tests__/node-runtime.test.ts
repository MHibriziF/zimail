import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startNodeRuntime } from '../node-runtime';

const dirs: string[] = [];
after(() => {
	for (const dir of dirs) {
		try {
			rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
		} catch {
			// Windows can hold the SQLite file a moment after close; a leftover temp folder is harmless.
		}
	}
});

function dataDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'zimail-runtime-'));
	dirs.push(dir);
	return dir;
}

describe('startNodeRuntime', () => {
	test('migrates the data folder and runs the jobs once straight away', async () => {
		let runs = 0;
		const runtime = await startNodeRuntime({ DATA_DIR: dataDir(), EMAIL_PROVIDER: 'smtp' }, async () => {
			runs += 1;
		});
		try {
			const migrated = await runtime.platform.env.DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first<{ n: number }>();
			assert.ok((migrated?.n ?? 0) > 0);
			assert.equal(runtime.platform.env.EMAIL_PROVIDER, 'smtp');
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.equal(runs, 1);
		} finally {
			runtime.stop();
		}
	});

	test('a failing run is contained, and the runtime keeps going', async () => {
		const logged: unknown[] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => logged.push(args);
		try {
			const runtime = await startNodeRuntime({ DATA_DIR: dataDir() }, async () => {
				throw new Error('boom');
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			runtime.stop();
		} finally {
			console.error = original;
		}
		assert.equal(logged.length, 1);
	});
});
