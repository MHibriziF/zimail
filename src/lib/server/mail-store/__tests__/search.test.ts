import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { createD1MailStoreRepository } from '../repository';

function capture() {
	const queries: { sql: string; args: unknown[] }[] = [];
	const repo = createD1MailStoreRepository(
		createFakeD1((query) => {
			queries.push(query);
			return [];
		})
	);
	return { repo, queries };
}

const likeGroups = (sql: string) => sql.match(/e\.subject LIKE \?/g)?.length ?? 0;

test('every search term must match on its own, not as one phrase', async () => {
	const { repo, queries } = capture();
	await repo.searchMessages('u1', { view: 'all', terms: ['invoice', '100%'] }, 5);
	const [{ sql, args }] = queries;
	assert.equal(likeGroups(sql), 2);
	assert.deepEqual(args.slice(1, 5), Array(4).fill('%invoice%'));
	assert.deepEqual(args.slice(5, 9), Array(4).fill(String.raw`%100\%%`));
	assert.equal(args.at(-1), 5);
});

test('with anyTerm, one matching word is enough', async () => {
	const { repo, queries } = capture();
	await repo.searchMessages('u1', { view: 'all', terms: ['invoice', 'due'], anyTerm: true }, 5);
	assert.match(queries[0].sql, /ESCAPE '\\'\) OR \(e\.subject LIKE/);
});

test('sender and dates narrow the search; a plain query keeps matching as a phrase', async () => {
	const { repo, queries } = capture();
	await repo.searchMessages('u1', { view: 'inbox', q: 'project review', from: 'Budi', after: '2026-08-01', before: '2026-09-01' }, 10);
	const [{ sql, args }] = queries;
	assert.equal(likeGroups(sql), 1);
	assert.match(sql, /e\.from_addr LIKE \? ESCAPE '\\' OR e\.from_name LIKE \?/);
	assert.match(sql, /e\.created_at >= \? AND e\.created_at < \?/);
	assert.deepEqual(args.slice(1), [
		...Array(4).fill('%project review%'),
		'%Budi%',
		'%Budi%',
		'2026-08-01',
		'2026-09-01',
		10
	]);
});
