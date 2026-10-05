import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS } from '../migrations.generated';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * The generated module is committed so `vite dev` and a fresh clone work with
 * no build step — which means it can fall behind the .sql files. A migration
 * added but not regenerated would deploy a Worker that quietly skips it.
 */
const sqlFiles = (folder: string) =>
	existsSync(folder)
		? readdirSync(folder)
				.filter((name) => name.endsWith('.sql'))
				.sort()
		: [];

test('the generated migrations match the files on disk', () => {
	const current = sqlFiles(join(root, 'migrations'));
	const archived = sqlFiles(join(root, 'migrations', 'archive'));

	assert.deepEqual(
		MIGRATIONS.map((migration) => `${migration.archived ? 'archive/' : ''}${migration.name}`),
		[...current, ...archived.map((name) => `archive/${name}`)],
		'run `bun scripts/generate-migrations.mjs`'
	);

	for (const migration of MIGRATIONS) {
		const file = join(root, 'migrations', migration.archived ? 'archive' : '', migration.name);
		assert.equal(
			migration.sql,
			readFileSync(file, 'utf8'),
			`${migration.name} differs from the file — run \`bun scripts/generate-migrations.mjs\``
		);
	}
});

test('nothing reaches for import.meta.glob in the migration path', () => {
	// wrangler bundles src/worker.ts with esbuild, which leaves the call intact
	// and throws on upload. That is what this whole generated module avoids.
	for (const file of ['src/lib/server/migrations/migrate.ts', 'src/lib/server/migrations/migrate-sql.ts']) {
		assert.doesNotMatch(
			readFileSync(join(root, file), 'utf8'),
			// A call, not a mention — the comments explain why it is absent.
			/import\.meta\s*\.\s*glob\s*\(/,
			`${file} must not use import.meta.glob — it is reachable from src/worker.ts`
		);
	}
});
