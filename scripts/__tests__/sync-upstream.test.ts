import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
/** What GitHub does when the sync pull request is merged. */
const mergePullRequest = (cwd: string) => spawnSync('git', ['merge', '--no-edit', 'sync/upstream'], { cwd, env, encoding: 'utf8' });

const config = (name: string, id: string) => `{\n  "name": "${name}",\n  "ai": { "binding": "AI" },\n  "database_id": "${id}"\n}\n`;

function init(dir: string) {
	execFileSync('git', ['init', '-q', '-b', 'main', dir], { env });
}

/** A Deploy-button copy: upstream's files as one unrelated commit, plus its own IDs. */
function copyOf(dir: string, files: Record<string, string>) {
	init(dir);
	for (const [file, text] of Object.entries(files)) write(dir, file, text);
	git(dir, 'add', '-A');
	git(dir, 'commit', '-qm', 'Initial commit');
	write(dir, 'wrangler.jsonc', config('my-mail', 'theirs'));
	git(dir, 'commit', '-qam', 'deploy my own');
	git(dir, 'remote', 'add', 'upstream', upstream);
}

const upstream = join(root, 'upstream');
init(upstream);
write(upstream, 'wrangler.jsonc', config('zimail', 'ours'));
write(upstream, 'app.txt', 'version 1\n');
write(upstream, 'README.md', 'Zimail\n');
git(upstream, 'add', '-A');
git(upstream, 'commit', '-qm', 'first');
const first = { 'wrangler.jsonc': config('zimail', 'ours'), 'app.txt': 'version 1\n', 'README.md': 'Zimail\n' };
write(upstream, 'app.txt', 'version 2\n');
write(upstream, 'new.txt', 'a new feature\n');
git(upstream, 'add', '-A');
git(upstream, 'commit', '-qm', 'second');

const copy = join(root, 'copy');
copyOf(copy, first);

test("a Deploy-button copy's first sync links it to upstream without changing a file", () => {
	const before = git(copy, 'rev-parse', 'HEAD^{tree}');
	const run = sync(copy);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stderr, /First sync: this repository starts from upstream \w+ first \(0 lines differ\)/);
	assert.match(run.stdout, /merges cleanly/);
	assert.equal(git(copy, 'rev-parse', 'HEAD^{tree}'), before, 'the link commit changes no files');
	assert.equal(git(copy, 'log', '-1', '--format=%s'), 'chore: record which Zimail version this copy started from');
	assert.equal(git(copy, 'rev-parse', 'sync/upstream'), git(copy, 'rev-parse', 'upstream/main'));
});

test('merging the pull request brings upstream in and keeps the copy’s own IDs', () => {
	const merge = mergePullRequest(copy);
	assert.equal(merge.status, 0, merge.stdout);
	assert.equal(read(copy, 'app.txt'), 'version 2\n');
	assert.equal(read(copy, 'new.txt'), 'a new feature\n');
	assert.equal(read(copy, 'wrangler.jsonc'), config('my-mail', 'theirs'));
});

test('with nothing new upstream, it says so', () => {
	const run = sync(copy);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /Already up to date/);
});

test('a copy made from the newest upstream needs no link commit yet', () => {
	const fresh = join(root, 'fresh');
	copyOf(fresh, { ...first, 'app.txt': 'version 2\n', 'new.txt': 'a new feature\n' });
	const head = git(fresh, 'rev-parse', 'HEAD');
	const run = sync(fresh);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /Already up to date/);
	assert.equal(git(fresh, 'rev-parse', 'HEAD'), head);
});

test('overlapping changes still produce the pull request, naming the files to resolve', () => {
	write(copy, 'README.md', 'My own mail\n');
	git(copy, 'commit', '-qam', 'my README');
	write(upstream, 'README.md', 'Zimail, now with more\n');
	git(upstream, 'commit', '-qam', 'readme');
	const run = sync(copy);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /overlapping changes to resolve on the pull request: README\.md/);
	assert.equal(git(copy, 'rev-parse', 'sync/upstream'), git(copy, 'rev-parse', 'upstream/main'));
	assert.equal(read(copy, 'README.md'), 'My own mail\n', 'nothing in the copy changes until the pull request is merged');
});

test("upstream's own workflows never reach the copy, which keeps its own", () => {
	const repo = join(root, 'workflows');
	copyOf(repo, { ...first, 'app.txt': 'version 2\n', 'new.txt': 'a new feature\n', 'README.md': 'Zimail, now with more\n' });
	mkdirSync(join(repo, '.github/workflows'), { recursive: true });
	write(repo, '.github/workflows/sync.yml', 'copy workflow\n');
	git(repo, 'add', '-A');
	git(repo, 'commit', '-qm', 'set up syncing');
	mkdirSync(join(upstream, '.github/workflows'), { recursive: true });
	write(upstream, '.github/workflows/ci.yml', 'upstream ci\n');
	write(upstream, 'app.txt', 'version 3\n');
	git(upstream, 'add', '-A');
	git(upstream, 'commit', '-qm', 'ci and v3');

	const run = sync(repo);
	assert.equal(run.status, 0, run.stderr);
	const workflowsOn = (ref: string) => git(repo, 'ls-tree', '-r', '--name-only', ref, '.github/workflows');
	assert.equal(workflowsOn('sync/upstream'), workflowsOn('main'), 'the branch adds or changes no workflow');
	assert.equal(git(repo, 'log', '-1', '--format=%s', 'sync/upstream'), "chore: keep this copy's own workflows");

	const merge = mergePullRequest(repo);
	assert.equal(merge.status, 0, merge.stdout);
	assert.equal(read(repo, 'app.txt'), 'version 3\n');
	assert.equal(read(repo, '.github/workflows/sync.yml'), 'copy workflow\n');
	assert.equal(spawnSync('git', ['cat-file', '-e', 'HEAD:.github/workflows/ci.yml'], { cwd: repo, env }).status, 128);
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
