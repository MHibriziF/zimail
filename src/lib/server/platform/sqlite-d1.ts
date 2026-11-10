import type { D1Database } from '@cloudflare/workers-types';
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

/**
 * D1's API over a local SQLite file, for running off Cloudflare. The SQL is
 * already SQLite, so repositories work unchanged; this only reproduces the
 * parts of D1 they use: `prepare().bind()` with `first`, `all`, `run` and
 * `raw`, plus `batch` and `exec`.
 *
 * `node:sqlite` is synchronous, so a `batch` runs start to finish without
 * yielding, inside one transaction, and nothing else can interleave with it.
 */

type Row = Record<string, unknown>;

type Meta = { duration: number; changes: number; last_row_id: number; changed_db: boolean; size_after: number; rows_read: number; rows_written: number };

type Result<T> = { success: true; meta: Meta; results: T[] };

/** Statements that hand rows back; anything else is executed with `run`. */
const READER = /^\s*(SELECT|WITH|PRAGMA|VALUES|EXPLAIN)\b/i;
const RETURNING = /\bRETURNING\b/i;

/** A statement may open with `-- notes` or `/* notes */`; what it does starts after them. */
function withoutLeadingComments(sql: string): string {
	let rest = sql.trimStart();
	for (;;) {
		if (rest.startsWith('--')) {
			const end = rest.indexOf('\n');
			rest = end < 0 ? '' : rest.slice(end + 1).trimStart();
		} else if (rest.startsWith('/*')) {
			const end = rest.indexOf('*/');
			rest = end < 0 ? '' : rest.slice(end + 2).trimStart();
		} else {
			return rest;
		}
	}
}

function returnsRows(sql: string): boolean {
	return READER.test(withoutLeadingComments(sql)) || RETURNING.test(sql);
}

/** D1 stores booleans as 0/1 and rejects `undefined`, so the wrapper does too. */
function toSqlValue(value: unknown, index: number): SQLInputValue {
	if (value === undefined) throw new TypeError(`D1_TYPE_ERROR: Type 'undefined' not supported for value at index ${index}`);
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return value as SQLInputValue;
}

function meta(changes = 0, lastRowId: number | bigint = 0): Meta {
	return {
		duration: 0,
		changes,
		last_row_id: Number(lastRowId),
		changed_db: changes > 0,
		size_after: 0,
		rows_read: 0,
		rows_written: changes
	};
}

/** `node:sqlite` rows have a null prototype; D1's are plain objects. */
function plain(row: unknown): Row {
	return { ...(row as Row) };
}

export function createSqliteD1(sqlite: DatabaseSync): D1Database {
	function execute(sql: string, args: SQLInputValue[]): Result<Row> {
		const statement: StatementSync = sqlite.prepare(sql);
		if (returnsRows(sql)) {
			return { success: true, meta: meta(), results: statement.all(...args).map(plain) };
		}
		const { changes, lastInsertRowid } = statement.run(...args);
		return { success: true, meta: meta(Number(changes), lastInsertRowid), results: [] };
	}

	function prepared(sql: string, args: SQLInputValue[]) {
		return {
			bind: (...values: unknown[]) => prepared(sql, values.map((value, index) => toSqlValue(value, index))),
			async first<T = Row>(column?: string): Promise<T | null> {
				const row = execute(sql, args).results[0];
				if (!row) return null;
				if (column === undefined) return row as T;
				if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
				return row[column] as T;
			},
			async all<T = Row>(): Promise<Result<T>> {
				return execute(sql, args) as Result<T>;
			},
			async run<T = Row>(): Promise<Result<T>> {
				return execute(sql, args) as Result<T>;
			},
			async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
				const rows = execute(sql, args).results;
				const values = rows.map((row) => Object.values(row));
				if (!options?.columnNames) return values as T[];
				return [Object.keys(rows[0] ?? {}), ...values] as T[];
			},
			/** For `batch`, which runs statements itself so they share one transaction. */
			executeNow: () => execute(sql, args)
		};
	}

	type Prepared = ReturnType<typeof prepared>;

	return {
		prepare: (sql: string) => prepared(sql, []),

		async batch(statements: Prepared[]) {
			sqlite.exec('BEGIN');
			try {
				const results = statements.map((statement) => statement.executeNow());
				sqlite.exec('COMMIT');
				return results;
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		},

		async exec(sql: string) {
			sqlite.exec(sql);
			return { count: sql.split(';').filter((part) => part.trim()).length, duration: 0 };
		}
	} as unknown as D1Database;
}
