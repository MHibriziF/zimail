import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { splitStatements } from '../migrate-sql';
import { MIGRATIONS } from '../migrations.generated';
import { applyToNewDatabase, replacedBy, snapshot, squashedSql, withIfNotExists, type SqlMigration } from '../squash';

const history: SqlMigration[] = [
	{ name: '0001_a.sql', sql: 'CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);\nCREATE INDEX people_name ON people(name);' },
	{ name: '0002_b.sql', sql: "ALTER TABLE people ADD COLUMN email TEXT;\nCREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);\nINSERT INTO settings VALUES ('theme', 'it''s dark');" },
	{
		name: '0003_c.sql',
		sql: `CREATE TABLE log (person TEXT);
CREATE TRIGGER people_log AFTER INSERT ON people
BEGIN
	INSERT INTO log VALUES (NEW.id);
END;
DROP INDEX people_name;
CREATE UNIQUE INDEX people_email ON people(email);`
	}
];

describe('squashing migrations', () => {
	const names = history.map((migration) => migration.name);
	const sql = squashedSql(history, names);

	test('the squash builds the same schema and seeded rows as the history', () => {
		assert.deepEqual(snapshot(applyToNewDatabase([{ name: 'squash', sql }])), snapshot(applyToNewDatabase(history)));
	});

	test('it keeps what ALTERs and later migrations did, and drops what they removed', () => {
		assert.match(sql, /CREATE TABLE IF NOT EXISTS people \(id TEXT PRIMARY KEY, name TEXT, email TEXT\)/);
		assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS people_email/);
		assert.doesNotMatch(sql, /people_name/);
		assert.match(sql, /CREATE TRIGGER IF NOT EXISTS people_log[\s\S]*END;/);
		assert.match(sql, /INSERT OR IGNORE INTO "settings" \("key", "value"\) VALUES \('theme', 'it''s dark'\);/);
	});

	test('running it on a database that already has everything changes nothing', () => {
		const db = applyToNewDatabase(history);
		const before = snapshot(db);
		for (const statement of splitStatements(sql)) db.exec(statement);
		assert.deepEqual(snapshot(db), before);
	});

	test('its header names what it replaces', () => {
		assert.deepEqual(replacedBy(sql), names);
		assert.deepEqual(replacedBy('CREATE TABLE t (id TEXT);'), []);
	});

	test('IF NOT EXISTS goes in once, whatever the case', () => {
		assert.equal(withIfNotExists('CREATE TABLE t (a)'), 'CREATE TABLE IF NOT EXISTS t (a)');
		assert.equal(withIfNotExists('create unique index i on t(a)'), 'create unique index IF NOT EXISTS i on t(a)');
		assert.equal(withIfNotExists('CREATE TABLE IF NOT EXISTS t (a)'), 'CREATE TABLE IF NOT EXISTS t (a)');
		assert.throws(() => withIfNotExists('DROP TABLE t'));
	});
});

describe('the squashes this repo ships', () => {
	const byName = new Map(MIGRATIONS.map((migration) => [migration.name, migration]));
	const squashes = MIGRATIONS.filter((migration) => migration.replaces);

	for (const squash of squashes) {
		test(`${squash.name} matches the history it replaces`, () => {
			const replaced = (squash.replaces ?? []).map((name) => {
				const migration = byName.get(name);
				assert.ok(migration, `${name} is missing from migrations/archive/`);
				return migration;
			});
			assert.deepEqual(snapshot(applyToNewDatabase([squash])), snapshot(applyToNewDatabase(replaced)));
		});
	}
});
