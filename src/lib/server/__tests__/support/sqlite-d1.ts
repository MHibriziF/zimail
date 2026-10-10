import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';

type SqliteStatement = {
	get(...args: unknown[]): unknown;
	all(...args: unknown[]): unknown[];
	run(...args: unknown[]): { changes: number };
};
type SqliteDatabase = {
	exec(sql: string): void;
	query(sql: string): SqliteStatement;
};

// A string specifier keeps svelte-check from resolving `bun:sqlite`, which has no types installed.
const sqliteModule = 'bun:sqlite';
const { Database } = (await import(sqliteModule)) as { Database: new (path: string) => SqliteDatabase };

const schemaUrl = new URL('../../../../../migrations/0001_squashed_0052.sql', import.meta.url);

/**
 * A real SQLite database behind D1's `prepare().bind()` chain, built from the
 * migrated schema. For tests where the SQL itself is under test, such as how
 * SQLite compares timestamps, which an in-memory fake cannot catch.
 */
export function createSqliteD1(): { db: D1Database; sqlite: SqliteDatabase } {
	const sqlite = new Database(':memory:');
	sqlite.exec(readFileSync(schemaUrl, 'utf8'));

	function statement(sql: string, args: unknown[]) {
		return {
			bind: (...next: unknown[]) => statement(sql, next),
			first: async () => sqlite.query(sql).get(...args) ?? null,
			all: async () => ({ results: sqlite.query(sql).all(...args) }),
			run: async () => ({ success: true, meta: { changes: sqlite.query(sql).run(...args).changes } })
		};
	}

	const db = {
		prepare: (sql: string) => statement(sql, []),
		batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
			const results = [];
			for (const stmt of statements) results.push(await stmt.run());
			return results;
		}
	} as unknown as D1Database;

	return { db, sqlite };
}
