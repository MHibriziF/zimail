/**
 * Which migrations to run, with squashes (#175) treated the way Django treats
 * `replaces`. A squash stands in for the migrations it replaces, which live on
 * in `migrations/archive/` for databases that only got part of the way:
 *
 * - every replaced migration is applied → the squash is recorded, nothing runs;
 * - none is → the squash runs;
 * - some are → the rest of them run, then the squash is recorded.
 *
 * Replaced migrations may be squashes themselves, from an earlier squash.
 */

export type PlannedMigration = {
	name: string;
	sql: string;
	/** Set on a squash: the migrations it stands in for. */
	replaces?: string[];
	/** In `migrations/archive/`: only ever run in place of part of a squash. */
	archived?: boolean;
};

/** One batch: run `sql` (or, when null, nothing) and record `name`. */
export type MigrationStep = { name: string; sql: string | null };

export function planMigrations(migrations: PlannedMigration[], recorded: ReadonlySet<string>): MigrationStep[] {
	const byName = new Map(migrations.map((migration) => [migration.name, migration]));
	const steps: MigrationStep[] = [];
	const planned = new Set<string>();

	const find = (name: string): PlannedMigration => {
		const migration = byName.get(name);
		if (!migration) throw new Error(`Migration ${name} is replaced by a squash but missing from migrations/archive/`);
		return migration;
	};

	const isDone = (name: string): boolean => {
		if (recorded.has(name) || planned.has(name)) return true;
		const replaces = find(name).replaces ?? [];
		return replaces.length > 0 && replaces.every(isDone);
	};

	/** Any of it applied, at any depth: a database stopped inside an older squash's history counts. */
	const isStarted = (name: string): boolean => isDone(name) || (find(name).replaces ?? []).some(isStarted);

	const record = (name: string, sql: string | null) => {
		steps.push({ name, sql });
		planned.add(name);
	};

	const ensure = (migration: PlannedMigration) => {
		if (recorded.has(migration.name) || planned.has(migration.name)) return;
		const replaces = migration.replaces ?? [];
		if (!replaces.some(isStarted)) {
			record(migration.name, migration.sql);
			return;
		}
		if (!replaces.every(isDone)) {
			for (const name of replaces) ensure(find(name));
		}
		record(migration.name, null);
	};

	const current = migrations
		.filter((migration) => !migration.archived)
		.sort((a, b) => a.name.localeCompare(b.name));
	for (const migration of current) ensure(migration);
	return steps;
}
