import type { D1Database } from '@cloudflare/workers-types';
import { splitStatements } from './migrate-sql';
import { MIGRATIONS } from './migrations.generated';
import { planMigrations, type PlannedMigration } from './plan';

/**
 * Applies pending D1 migrations from inside the Worker.
 *
 * Deploy to Cloudflare provisions the database but never runs migrations, so a
 * fresh deploy would otherwise land on a schema-less D1 and fail on the first
 * query — the person deploying has to know to run wrangler by hand. Bundling
 * the migrations and applying them on first use makes the button enough.
 *
 * `d1_migrations` is wrangler's own table, with wrangler's own schema and
 * naming, so the two paths are interchangeable: whichever runs first, the other
 * sees the work as done.
 */

const CREATE_TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

/**
 * Every migration, current and archived, read from a generated module rather
 * than `import.meta.glob`, because `src/worker.ts` is bundled by wrangler's
 * esbuild and never sees Vite's transforms — the glob survived as a literal
 * call there and threw on upload.
 */
export function listMigrations(): PlannedMigration[] {
	return [...MIGRATIONS];
}

/** The newest current migration: if it is recorded, so is everything before it. */
function latestMigration(): string | null {
	const current = listMigrations()
		.filter((migration) => !migration.archived)
		.map((migration) => migration.name)
		.sort((a, b) => a.localeCompare(b));
	return current.at(-1) ?? null;
}

/**
 * One row instead of every row of `d1_migrations`. Every cold isolate checks
 * — every minute's cron tick included — so the full read only happens when a
 * deploy brought something new.
 */
async function isUpToDate(db: D1Database): Promise<boolean> {
	const latest = latestMigration();
	if (!latest) return true;
	try {
		return (await db.prepare('SELECT 1 AS ok FROM d1_migrations WHERE name = ?').bind(latest).first()) !== null;
	} catch {
		// No tracking table yet: a brand-new database.
		return false;
	}
}

async function appliedNames(db: D1Database): Promise<Set<string>> {
	await db.prepare(CREATE_TRACKING_TABLE).run();
	const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
	return new Set(results.map((row) => row.name));
}

/**
 * Applies whatever has not run yet, oldest first — see `planMigrations` for
 * how a squash stands in for the migrations it replaces.
 *
 * Each step goes to D1 as one batch — its statements plus the row recording
 * it — so it either lands whole or not at all. That is also what makes it safe
 * for two requests to arrive at once on a cold deploy: the second batch fails
 * on the name's UNIQUE constraint and rolls back rather than applying anything
 * twice.
 */
export async function applyPendingMigrations(db: D1Database): Promise<string[]> {
	if (await isUpToDate(db)) return [];
	const steps = planMigrations(listMigrations(), await appliedNames(db));

	const ran: string[] = [];

	for (const step of steps) {
		const statements = splitStatements(step.sql ?? '').map((statement) => db.prepare(statement));

		try {
			await db.batch([
				...statements,
				db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(step.name)
			]);
			ran.push(step.name);
		} catch (error) {
			// Another request got there first: it is applied, not broken.
			if ((await appliedNames(db)).has(step.name)) continue;
			throw new Error(`Migration ${step.name} failed: ${describe(error)}`);
		}
	}

	return ran;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the migrations at most once per isolate.
 *
 * The promise is cached rather than the result, so requests arriving together
 * in one isolate wait on the same run instead of starting their own. A failure
 * clears the cache so the next request can try again — a half-migrated
 * database that never retries would be worse than a slow one.
 */
let inFlight: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
	if (!inFlight) {
		inFlight = applyPendingMigrations(db)
			.then((ran) => {
				if (ran.length > 0) {
					console.log(`applied ${ran.length} migration(s): ${ran.join(', ')}`);
				}
			})
			.catch((error) => {
				inFlight = null;
				throw error;
			});
	}

	return inFlight;
}
