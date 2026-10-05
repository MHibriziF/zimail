import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { splitStatements } from '../migrate-sql';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('splitting a migration into statements', () => {
	test('drops comments and blank space', () => {
		assert.deepEqual(
			splitStatements(`-- a note
			CREATE TABLE t (id TEXT);

			-- another note
			CREATE INDEX i ON t(id);`),
			['CREATE TABLE t (id TEXT);'.slice(0, -1), 'CREATE INDEX i ON t(id);'.slice(0, -1)]
		);
	});

	test('a semicolon inside a string is not a boundary', () => {
		const statements = splitStatements("UPDATE t SET note = 'one; two' WHERE id = 1;");
		assert.equal(statements.length, 1);
		assert.match(statements[0], /'one; two'/);
	});

	test('a double dash inside a string is not a comment', () => {
		const statements = splitStatements("INSERT INTO t (note) VALUES ('a -- b');");
		assert.equal(statements.length, 1);
		assert.match(statements[0], /'a -- b'/);
	});

	test('an escaped quote does not end the string', () => {
		const statements = splitStatements("UPDATE t SET note = 'it''s here; really';");
		assert.equal(statements.length, 1);
		assert.match(statements[0], /it''s here; really/);
	});

	test('a trigger stays one statement, body and all', () => {
		const statements = splitStatements(`CREATE TRIGGER t_evict AFTER INSERT ON t
			BEGIN
				UPDATE u SET cache = NULL WHERE id = NEW.u_id;
				DELETE FROM v WHERE id = NEW.id;
			END;
			CREATE INDEX i ON t(id);`);
		assert.equal(statements.length, 2);
		assert.match(statements[0], /^CREATE TRIGGER[\s\S]*NEW\.u_id;[\s\S]*NEW\.id;\s*END$/);
		assert.equal(statements[1], 'CREATE INDEX i ON t(id)');
	});

	test('a file with no statements yields none', () => {
		assert.deepEqual(splitStatements('-- comment only\n\n'), []);
	});
});

describe('the migrations this repo ships', () => {
	const files = readdirSync(join(root, 'migrations')).filter((name) => name.endsWith('.sql'));
	const archiveDir = join(root, 'migrations', 'archive');
	const archived = existsSync(archiveDir)
		? readdirSync(archiveDir)
				.filter((name) => name.endsWith('.sql'))
				.map((name) => join('archive', name))
		: [];

	test('every one parses into at least one statement', () => {
		assert.ok(files.length > 0, 'expected migrations to exist');

		for (const file of [...files, ...archived]) {
			const sql = readFileSync(join(root, 'migrations', file), 'utf8');
			const statements = splitStatements(sql);
			assert.ok(statements.length > 0, `${file} produced no statements`);

			for (const statement of statements) {
				// A comment leaking through as its own statement would be sent to
				// D1 and rejected, which is the failure this guards.
				assert.doesNotMatch(statement, /^--/, `${file} kept a comment as a statement`);
				assert.match(statement, /^[A-Za-z]/, `${file} produced "${statement.slice(0, 40)}…"`);
			}
		}
	});

	test('filenames sort into the order they must run in', () => {
		const sorted = [...files].sort();
		assert.deepEqual(files.map((name) => name.slice(0, 4)).sort(), sorted.map((name) => name.slice(0, 4)));

		// Numbering must be unique, or two migrations race for the same slot.
		const numbers = sorted.map((name) => name.slice(0, 4));
		assert.equal(new Set(numbers).size, numbers.length, 'duplicate migration number');
	});
});
