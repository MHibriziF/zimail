#!/usr/bin/env bun
/**
 * `bun run db:squash`: folds every migration in `migrations/` into one, the
 * way Django's squashmigrations does (#175).
 *
 * The squash is the schema SQLite ends up with after the whole history, read
 * back from `sqlite_master`, with IF NOT EXISTS throughout. Its header lists
 * the migrations it replaces, which move to `migrations/archive/`: the Worker
 * keeps them for databases that only got part of the way (see
 * `src/lib/server/migrations/plan.ts`), and wrangler, which only reads the
 * top level, never sees them.
 *
 * New migrations keep numbering on from the last one squashed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { squashedSql } from '../src/lib/server/migrations/squash.ts';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'migrations');
const archiveDir = path.join(dir, 'archive');

const current = readdirSync(dir)
	.filter((name) => name.endsWith('.sql'))
	.sort();
if (current.length < 2) {
	console.log(`db:squash: ${current.length} migration(s) in migrations/, nothing to squash.`);
	process.exit(0);
}

const last = current.at(-1);
const name = `0001_squashed_${last.slice(0, 4)}.sql`;
if (current.includes(name)) {
	console.log(`db:squash: ${name} is already the only squash of these migrations.`);
	process.exit(0);
}

mkdirSync(archiveDir, { recursive: true });
const clash = current.find((file) => existsSync(path.join(archiveDir, file)));
if (clash) throw new Error(`migrations/archive/${clash} already exists; refusing to overwrite it.`);

const migrations = current.map((file) => ({
	name: file,
	sql: readFileSync(path.join(dir, file), 'utf8').replaceAll('\r\n', '\n')
}));
const sql = squashedSql(migrations, current);

for (const file of current) renameSync(path.join(dir, file), path.join(archiveDir, file));
writeFileSync(path.join(dir, name), sql, 'utf8');

console.log(`db:squash: ${current.length} migrations -> migrations/${name}; the originals are in migrations/archive/.`);
console.log(`db:squash: number the next migration ${String(Number(last.slice(0, 4)) + 1).padStart(4, '0')}_….`);
