import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createFsBucket } from './fs-bucket';
import { createSqliteD1 } from './sqlite-d1';

/**
 * What `platform` is when Zimail runs off Cloudflare: the same `env` the
 * Worker gets, with D1 and R2 replaced by a SQLite file and a folder under
 * `dataDir`. Everything that reads `platform.env.DB` or `ATTACHMENTS` keeps
 * working unchanged.
 */
export type NodePlatformOptions = {
	/** Holds `zimail.db` and the `blobs/` folder. One volume to back up. */
	dataDir: string;
	/** Settings and secrets, as the Worker reads them from `env`. */
	vars: Record<string, string | undefined>;
};

export type NodePlatform = App.Platform & { close(): void };

/** Work after the response has nothing to keep it alive here, so it just has to log its failure. */
function background(promise: Promise<unknown>): void {
	promise.catch((error) => console.error('background task failed', error));
}

export function openSqlite(path: string): DatabaseSync {
	const sqlite = new DatabaseSync(path);
	// D1 enforces foreign keys; WAL lets reads continue while a write is in progress.
	sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
	return sqlite;
}

export function createNodePlatform({ dataDir, vars }: NodePlatformOptions): NodePlatform {
	mkdirSync(join(dataDir, 'blobs'), { recursive: true });
	const sqlite = openSqlite(join(dataDir, 'zimail.db'));

	const env = {
		...vars,
		DB: createSqliteD1(sqlite),
		ATTACHMENTS: createFsBucket(join(dataDir, 'blobs'))
	} as unknown as App.Platform['env'];

	const ctx = {
		waitUntil: background,
		passThroughOnException() {},
		props: {}
	} as unknown as App.Platform['ctx'];

	return { env, ctx, close: () => sqlite.close() };
}
