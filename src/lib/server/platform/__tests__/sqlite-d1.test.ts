import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteD1 } from '../sqlite-d1';

function setup() {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL UNIQUE, done INTEGER NOT NULL DEFAULT 0)');
	return { db: createSqliteD1(sqlite), sqlite };
}

describe('createSqliteD1', () => {
	test('run reports changes and the new row id', async () => {
		const { db } = setup();
		const result = await db.prepare('INSERT INTO notes (body) VALUES (?)').bind('a').run();
		assert.equal(result.success, true);
		assert.equal(result.meta.changes, 1);
		assert.equal(result.meta.last_row_id, 1);

		const none = await db.prepare('UPDATE notes SET done = 1 WHERE body = ?').bind('missing').run();
		assert.equal(none.meta.changes, 0);
	});

	test('first returns the row, one column of it, or null', async () => {
		const { db } = setup();
		await db.prepare('INSERT INTO notes (body) VALUES (?)').bind('a').run();
		const select = db.prepare('SELECT id, body FROM notes WHERE body = ?');

		assert.deepEqual(await select.bind('a').first(), { id: 1, body: 'a' });
		assert.equal(await select.bind('a').first('body'), 'a');
		assert.equal(await select.bind('b').first(), null);
		await assert.rejects(select.bind('a').first('nope'), /D1_COLUMN_NOTFOUND/);
	});

	test('rows are plain objects, as D1 returns them', async () => {
		const { db } = setup();
		await db.prepare('INSERT INTO notes (body) VALUES (?)').bind('a').run();
		const { results } = await db.prepare('SELECT body FROM notes').all();
		assert.equal(Object.getPrototypeOf(results[0]), Object.prototype);
	});

	test('all returns rows, including from RETURNING', async () => {
		const { db } = setup();
		const inserted = await db.prepare('INSERT INTO notes (body) VALUES (?), (?) RETURNING id').bind('a', 'b').all();
		assert.deepEqual(inserted.results, [{ id: 1 }, { id: 2 }]);
		const { results } = await db.prepare('SELECT body FROM notes ORDER BY id').all<{ body: string }>();
		assert.deepEqual(results.map((row) => row.body), ['a', 'b']);
	});

	test('raw returns arrays, optionally led by the column names', async () => {
		const { db } = setup();
		await db.prepare('INSERT INTO notes (body) VALUES (?)').bind('a').run();
		const select = db.prepare('SELECT id, body FROM notes');
		assert.deepEqual(await select.raw(), [[1, 'a']]);
		assert.deepEqual(await select.raw({ columnNames: true }), [['id', 'body'], [1, 'a']]);
	});

	test('binds booleans as 0/1 and rejects undefined, like D1', async () => {
		const { db } = setup();
		await db.prepare('INSERT INTO notes (body, done) VALUES (?, ?)').bind('a', true).run();
		assert.equal(await db.prepare('SELECT done FROM notes').first('done'), 1);
		assert.throws(() => db.prepare('SELECT ?').bind(undefined), /D1_TYPE_ERROR/);
	});

	test('a bad statement fails when it runs, not when it is prepared', async () => {
		const { db } = setup();
		const statement = db.prepare('SELECT FROM nowhere');
		await assert.rejects(statement.all());
	});

	test('batch commits every statement or none', async () => {
		const { db } = setup();
		const insert = db.prepare('INSERT INTO notes (body) VALUES (?)');

		const results = await db.batch([insert.bind('a'), insert.bind('b'), db.prepare('SELECT COUNT(*) AS n FROM notes')]);
		assert.equal(results[0].meta.changes, 1);
		assert.deepEqual(results[2].results, [{ n: 2 }]);

		await assert.rejects(db.batch([insert.bind('c'), insert.bind('a')]), /UNIQUE constraint failed/);
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM notes').first('n'), 2);
	});

	test('exec runs several statements', async () => {
		const { db } = setup();
		await db.exec("INSERT INTO notes (body) VALUES ('a'); INSERT INTO notes (body) VALUES ('b');");
		assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM notes').first('n'), 2);
	});
});
