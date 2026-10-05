/**
 * Squashing migrations (#175), at build time only: `scripts/squash-migrations.mjs`
 * and the tests use it; the Worker never imports it.
 *
 * The squash is read back from SQLite itself rather than stitched together
 * from the files: apply the history to an empty database, then write out what
 * `sqlite_master` holds. That is the schema after every ALTER, rename and
 * table rebuild, and it can't drift from what the history produces.
 */
import { DatabaseSync } from 'node:sqlite';
import { splitStatements } from './migrate-sql';

export type SqlMigration = { name: string; sql: string };

/** Where the replaced migrations' names are listed in a squash. */
export const REPLACES_PREFIX = '-- replaces:';

/** Applies migrations statement by statement, as D1 receives them. */
export function applyToNewDatabase(migrations: SqlMigration[]): DatabaseSync {
	const db = new DatabaseSync(':memory:');
	for (const migration of migrations) {
		for (const statement of splitStatements(migration.sql)) db.exec(statement);
	}
	return db;
}

type MasterRow = { type: string; name: string; tbl_name: string; sql: string };

const OBJECT_ORDER = ['table', 'index', 'view', 'trigger'];

/** Everything the migrations created, tables first so indexes, views and triggers find theirs. */
function schemaObjects(db: DatabaseSync): MasterRow[] {
	const rows = db
		.prepare(
			`SELECT type, name, tbl_name, sql FROM sqlite_master
			 WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
			 ORDER BY rowid`
		)
		.all() as MasterRow[];
	return OBJECT_ORDER.flatMap((type) => rows.filter((row) => row.type === type));
}

/** `CREATE TABLE x` → `CREATE TABLE IF NOT EXISTS x`, so running it on a migrated database does nothing. */
export function withIfNotExists(sql: string): string {
	const match = /^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+/i.exec(sql);
	if (!match) throw new Error(`Not a CREATE statement: ${sql.slice(0, 60)}`);
	const rest = sql.slice(match[0].length);
	if (rest.toUpperCase().startsWith('IF NOT EXISTS')) return sql;
	return `${match[0]}IF NOT EXISTS ${rest}`;
}

function sqlLiteral(value: unknown): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number' || typeof value === 'bigint') return String(value);
	if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
	return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdentifier(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

/** Rows the migrations themselves inserted (defaults, seeds), as INSERT OR IGNORE. */
function seededRows(db: DatabaseSync, tables: string[]): string[] {
	return tables.flatMap((table) => {
		const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Record<string, unknown>[];
		return rows.map((row) => {
			const columns = Object.keys(row);
			return `INSERT OR IGNORE INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns
				.map((column) => sqlLiteral(row[column]))
				.join(', ')});`;
		});
	});
}

/** The squashed migration's SQL: one statement per schema object, then any seeded rows. */
export function squashedSql(migrations: SqlMigration[], replaces: string[]): string {
	const db = applyToNewDatabase(migrations);
	try {
		const objects = schemaObjects(db);
		const tables = objects.filter((object) => object.type === 'table').map((object) => object.name);
		return [
			`-- Squashed by \`bun run db:squash\` from ${replaces.length} migrations, kept in migrations/archive/.`,
			'-- Every statement is IF NOT EXISTS / OR IGNORE, so it is a no-op on a database that already has them.',
			`${REPLACES_PREFIX} ${replaces.join(' ')}`,
			'',
			...objects.map((object) => `${withIfNotExists(object.sql)};\n`),
			...seededRows(db, tables),
			''
		].join('\n');
	} finally {
		db.close();
	}
}

/** The names a squash replaces, from its header; empty for an ordinary migration. */
export function replacedBy(sql: string): string[] {
	const line = sql.split('\n').find((entry) => entry.startsWith(REPLACES_PREFIX));
	return line ? line.slice(REPLACES_PREFIX.length).trim().split(/\s+/).filter(Boolean) : [];
}

/**
 * A comparable picture of a database: its schema objects (with whitespace and
 * IF NOT EXISTS evened out) and the rows in each table.
 */
export function snapshot(db: DatabaseSync): { schema: string[]; rows: Record<string, unknown[]> } {
	const objects = schemaObjects(db);
	const normalize = (sql: string) => sql.replaceAll(/\s+/g, ' ').replace(/ IF NOT EXISTS /i, ' ').trim();
	const schema = objects.map((object) => `${object.type} ${object.name} ON ${object.tbl_name}: ${normalize(object.sql)}`).sort();
	const rows: Record<string, unknown[]> = {};
	for (const object of objects.filter((entry) => entry.type === 'table')) {
		rows[object.name] = db.prepare(`SELECT * FROM ${quoteIdentifier(object.name)}`).all();
	}
	return { schema, rows };
}
