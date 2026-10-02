import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const SCRIPT = resolve('scripts/sync-upstream.sh');
const env = {
	...process.env,
	GIT_AUTHOR_NAME: 'test',
	GIT_AUTHOR_EMAIL: 'test@example.com',
	GIT_COMMITTER_NAME: 'test',
	GIT_COMMITTER_EMAIL: 'test@example.com',
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1'
};
const root = mkdtempSync(join(tmpdir(), 'sync-upstream-'));
after(() => rmSync(root, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const write = (dir: string, file: string, text: string) => writeFileSync(join(dir, file), text);
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');
const sync = (cwd: string) => spawnSync('bash', [SCRIPT], { cwd, env, encoding: 'utf8' });

const config = (name: string, id: string) => `{\n  "name": "${name}",\n  "ai": { "binding": "AI" },\n  "database_id": "${id}"\n}\n`;

// Upstream: two commits. The copy is made from the first, the way the Deploy button makes one:
// the same files as a single commit with no shared history, then that deployment's own IDs.
const upstream = join(root, 'upstream');
const copy = join(root, 'copy');
for (const dir of [upstream, copy]) execFileSync('git', ['init', '-q', '-b', 'main', dir], { env });
write(upstream, 'wrangler.jsonc', config('zimail', 'ours'));
write(upstream, 'app.txt', 'version 1\n');
git(upstream, 'add', '-A');
git(upstream, 'commit', '-qm', 'first');
write(copy, 'wrangler.jsonc', config('zimail', 'ours'));
write(copy, 'app.txt', 'version 1\n');
git(copy, 'add', '-A');
git(copy, 'commit', '-qm', 'Initial commit');
write(copy, 'wrangler.jsonc', config('my-mail', 'theirs'));
git(copy, 'commit', '-qam', 'deploy my own');
write(upstream, 'app.txt', 'version 2\n');
write(upstream, 'new.txt', 'a new feature\n');
git(upstream, 'add', '-A');
git(upstream, 'commit', '-qm', 'second');
git(copy, 'remote', 'add', 'upstream', upstream);

test("a Deploy-button copy's first sync brings upstream in and keeps its own IDs", () => {
	git(copy, 'fetch', '-q', 'upstream', 'main');
	const run = sync(copy);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stderr, /First sync: this repository starts from upstream \w+ first \(0 lines differ\)/);
	assert.equal(git(copy, 'rev-parse', '--abbrev-ref', 'HEAD'), 'sync/upstream');
	assert.equal(read(copy, 'app.txt'), 'version 2\n');
	assert.equal(read(copy, 'new.txt'), 'a new feature\n');
	assert.equal(read(copy, 'wrangler.jsonc'), config('my-mail', 'theirs'));
	assert.equal(git(copy, 'replace', '-l'), '', 'the graft is not left behind');
});

test('with nothing new upstream, it says so and changes nothing', () => {
	git(copy, 'checkout', '-q', 'main');
	git(copy, 'merge', '-q', '--ff-only', 'sync/upstream');
	const run = sync(copy);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /Already up to date/);
});

test('a copy made from the newest upstream has nothing to sync, even the first time', () => {
	const fresh = join(root, 'fresh');
	execFileSync('git', ['init', '-q', '-b', 'main', fresh], { env });
	for (const file of ['wrangler.jsonc', 'app.txt', 'new.txt']) write(fresh, file, read(upstream, file));
	git(fresh, 'add', '-A');
	git(fresh, 'commit', '-qm', 'Initial commit');
	git(fresh, 'remote', 'add', 'upstream', upstream);
	git(fresh, 'fetch', '-q', 'upstream', 'main');
	const run = sync(fresh);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /Already up to date/);
	assert.equal(git(fresh, 'rev-parse', 'HEAD'), git(fresh, 'rev-parse', 'main'), 'no merge commit was made');
	assert.equal(git(fresh, 'replace', '-l'), '');
});

test('a real conflict stops the sync, names the file, and leaves no half-done merge', () => {
	write(upstream, 'wrangler.jsonc', config('zimail-renamed', 'ours'));
	git(upstream, 'commit', '-qam', 'rename');
	git(copy, 'fetch', '-q', 'upstream', 'main');
	const run = sync(copy);
	assert.equal(run.status, 1);
	assert.match(run.stderr, /wrangler\.jsonc/);
	assert.equal(git(copy, 'status', '--porcelain'), '');
	assert.equal(read(copy, 'wrangler.jsonc'), config('my-mail', 'theirs'));
});

// The Deploy button doesn't copy workflows, so the README's "Set up syncing" link carries the
// whole workflow file for GitHub to prefill. It must stay the same file.
test("the README's Set up syncing links add exactly the sync workflow", () => {
	const workflow = readFileSync(resolve('.github/workflows/sync-upstream.yml'), 'utf8').replaceAll('\r\n', '\n');
	const links = [...readFileSync(resolve('README.md'), 'utf8').matchAll(/\]\((\.\.\/\.\.\/new\/main\/\.github\/workflows\?[^)\s]+)\)/g)];
	assert.ok(links.length >= 1, 'the README has a Set up syncing link');
	for (const [, link] of links) {
		const query = new URLSearchParams(link.slice(link.indexOf('?') + 1));
		assert.equal(query.get('filename'), 'sync-upstream.yml');
		assert.equal(query.get('value'), workflow);
	}
});
