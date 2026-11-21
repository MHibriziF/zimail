import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Every file a shell can render the mailbox with.
 *
 * Both shells own their composer and thread pane, which is how scheduled send
 * came to work in Classic and be missing from Zero: each built its own request
 * body, so a field added to one never reached the other. These tests hold the
 * writes in `$lib/mail/client.ts` where a change reaches both.
 */
function shellSources(): string[] {
	const files: string[] = [];

	const walk = (relative: string) => {
		const absolute = join(root, relative);
		if (!existsSync(absolute)) return;
		for (const entry of readdirSync(absolute, { withFileTypes: true })) {
			const next = `${relative}/${entry.name}`;
			if (entry.isDirectory()) walk(next);
			else if (entry.name.endsWith('.svelte')) files.push(next);
		}
	};

	walk('src/themes');
	walk('src/lib/components');
	walk('src/routes');

	return files;
}

/** A mutating fetch: anything that is not a plain GET. */
const WRITING_FETCH = /fetch\(\s*[`'"][^`'"]*\/api\/mail[^`'"]*[`'"]\s*,\s*\{[\s\S]{0,200}?method:\s*['"](?!GET)/;

test('shells write to the mailbox through the shared client', () => {
	const sources = shellSources();
	assert.ok(sources.length > 0, 'expected to find shell sources');

	for (const file of sources) {
		const source = readFileSync(join(root, file), 'utf8');
		assert.doesNotMatch(
			source,
			WRITING_FETCH,
			`${file} posts to /api/mail directly — use $lib/mail/client instead, or both shells will drift`
		);
	}
});

test('every composer offers scheduled send', () => {
	// The control differs per shell — Classic has SendButton, Zero puts the
	// caret in ComposerActions — so this asserts the capability reaches the
	// send call, not the markup.
	const composers = [
		'src/routes/(app)/compose/+page.svelte',
		'src/themes/zero/overlays/ComposeDialog.svelte'
	];

	for (const file of composers) {
		const source = readFileSync(join(root, file), 'utf8');
		assert.match(source, /sendMessage\(/, file);
		assert.match(source, /scheduledAt/, file);
	}
});

test('every thread view can send a reply and recall a scheduled one', () => {
	const threads = ['src/routes/(app)/mail/[id]/+page.svelte', 'src/themes/zero/mail/ThreadPane.svelte'];

	for (const file of threads) {
		const source = readFileSync(join(root, file), 'utf8');
		assert.match(source, /sendReply\(/, file);
		assert.match(source, /cancelScheduledSend\(/, file);
	}
});
