import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { createSqliteD1 } from '../../__tests__/support/sqlite-d1';
import { mailStoreServiceForDb } from '../index';
import { BACKFILL_BATCH, runSearchIndexBackfill } from '../search-index';

let next = 0;

function setup() {
	const { db, sqlite } = createSqliteD1();
	sqlite.exec(`INSERT INTO users (id, email, name, password_hash) VALUES ('u1', 'sam@example.test', 'Sam', 'x')`);
	return { db, sqlite };
}

function addEmail(sqlite: DatabaseSync, fields: { subject: string; body?: string; from?: string; status?: string | null }) {
	const id = `m${++next}`;
	sqlite
		.prepare(
			`INSERT INTO emails (id, user_id, direction, from_addr, from_name, to_addr, subject, body_text, status, created_at)
			 VALUES (?, 'u1', 'inbound', ?, 'Priya Raman', 'sam@example.test', ?, ?, ?, datetime('now'))`
		)
		.run(id, fields.from ?? 'priya@example.com', fields.subject, fields.body ?? '', fields.status ?? null);
	return id;
}

const indexed = (sqlite: DatabaseSync) =>
	(sqlite.prepare('SELECT email_id FROM emails_fts ORDER BY rowid').all() as { email_id: string }[]).map((row) => row.email_id);

const subjects = async (db: Parameters<typeof mailStoreServiceForDb>[0], q: string) =>
	(await mailStoreServiceForDb(db).listMailbox('u1', { view: 'all', q })).threads.map((thread) => thread.subject);

describe('mail search index', () => {
	it('starts ready on a database with no mail', () => {
		const { sqlite } = setup();
		assert.deepEqual({ ...sqlite.prepare('SELECT cursor, ready FROM search_index_state').get() }, { cursor: 0, ready: 1 });
	});

	it('indexes new mail but not drafts, and follows edits and deletes', () => {
		const { sqlite } = setup();
		const mail = addEmail(sqlite, { subject: 'Brand refresh' });
		const draft = addEmail(sqlite, { subject: 'Half written', status: 'draft' });
		assert.deepEqual(indexed(sqlite), [mail]);

		sqlite.prepare(`UPDATE emails SET status = 'sent' WHERE id = ?`).run(draft);
		assert.deepEqual(indexed(sqlite).sort(), [draft, mail].sort());

		sqlite.prepare(`UPDATE emails SET subject = 'Logo directions' WHERE id = ?`).run(mail);
		const match = sqlite.prepare(`SELECT email_id FROM emails_fts WHERE emails_fts MATCH '"logo"*'`).all().map((row) => ({ ...row }));
		assert.deepEqual(match, [{ email_id: mail }]);

		sqlite.prepare('DELETE FROM emails WHERE id = ?').run(mail);
		assert.deepEqual(indexed(sqlite), [draft]);
	});

	it('writes nothing to the index when only flags change', () => {
		const { sqlite } = setup();
		const mail = addEmail(sqlite, { subject: 'Quarterly planning' });
		const before = sqlite.prepare('SELECT COUNT(*) AS n FROM emails_fts_data').get();
		sqlite.prepare('UPDATE emails SET is_read = 1, is_starred = 1 WHERE id = ?').run(mail);
		assert.deepEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM emails_fts_data').get(), before);
	});

	it('finds words by prefix and phrases, and falls back to a LIKE scan when the index finds nothing', async () => {
		const { db, sqlite } = setup();
		addEmail(sqlite, { subject: 'Brand refresh: first round of logo directions', body: 'The continuous line holds up.' });
		addEmail(sqlite, { subject: 'Lunch on Thursday?', body: 'Ramen by the station.' });
		addEmail(sqlite, { subject: '会议纪要', body: '明天开会' });

		assert.deepEqual(await subjects(db, 'logo dir'), ['Brand refresh: first round of logo directions']);
		assert.deepEqual(await subjects(db, '"continuous line"'), ['Brand refresh: first round of logo directions']);
		assert.deepEqual(await subjects(db, 'thurs'), ['Lunch on Thursday?']);
		// Mid-word and unspaced Chinese aren't index words; the LIKE scan still finds them.
		assert.deepEqual(await subjects(db, 'amen'), ['Lunch on Thursday?']);
		assert.deepEqual(await subjects(db, '开会'), ['会议纪要']);
		assert.deepEqual(await subjects(db, 'nothing like this'), []);
	});

	it('backfills older mail in batches on its minute, then reports ready', async () => {
		const { db, sqlite } = setup();
		const total = BACKFILL_BATCH + 5;
		for (let i = 0; i < total; i++) addEmail(sqlite, { subject: `Old message ${i}` });
		addEmail(sqlite, { subject: 'Old draft', status: 'draft' });
		// As if these were there before the index: empty it and rewind the state.
		sqlite.exec(`DELETE FROM emails_fts;
			UPDATE search_index_state SET backfill_max = (SELECT MAX(rowid) FROM emails), cursor = 0, ready = 0;`);

		assert.equal(await runSearchIndexBackfill(db, new Date('2026-11-24T10:03:00Z')), null);
		assert.equal(indexed(sqlite).length, 0);

		const onTurn = new Date('2026-11-24T10:10:00Z');
		assert.deepEqual(await runSearchIndexBackfill(db, onTurn), { indexed: BACKFILL_BATCH, done: false });
		assert.equal(indexed(sqlite).length, BACKFILL_BATCH);

		const newer = addEmail(sqlite, { subject: 'Arrived during the backfill' });
		assert.deepEqual(await runSearchIndexBackfill(db, onTurn), { indexed: 6, done: true });
		assert.equal(indexed(sqlite).length, total + 1);
		assert.ok(indexed(sqlite).includes(newer));
		assert.equal((sqlite.prepare('SELECT ready FROM search_index_state').get() as { ready: number }).ready, 1);
		assert.equal(await runSearchIndexBackfill(db, onTurn), null);
	});

	it('keeps using the LIKE scan until the backfill is done', async () => {
		const { db, sqlite } = setup();
		addEmail(sqlite, { subject: 'Invoice #1042 paid' });
		sqlite.exec('DELETE FROM emails_fts; UPDATE search_index_state SET ready = 0;');
		assert.deepEqual(await subjects(db, 'invoice'), ['Invoice #1042 paid']);
	});
});
