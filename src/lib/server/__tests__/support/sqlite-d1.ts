import type { D1Database } from '@cloudflare/workers-types';
import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../../migrations/migrations.generated';
import { applyToNewDatabase } from '../../migrations/squash';
import { createSqliteD1 as wrapSqlite } from '../../platform/sqlite-d1';

/**
 * A real SQLite database on the migrated schema, behind the same D1 wrapper a
 * self-hosted install runs on. For tests where the SQL itself is under test,
 * such as how SQLite compares timestamps, which an in-memory fake cannot catch.
 */
export function createSqliteD1(): { db: D1Database; sqlite: DatabaseSync } {
	const sqlite = applyToNewDatabase(MIGRATIONS.filter((migration) => !migration.archived));
	return { db: wrapSqlite(sqlite), sqlite };
}
