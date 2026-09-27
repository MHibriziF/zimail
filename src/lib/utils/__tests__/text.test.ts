import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { stripHtml } from '../../server/util/html';
import { firstAngled, firstEmailLike, removeElements, splitTrailingAngled, stripTags, trimTrailing } from '../text';

/** Short strings over the characters these parsers care about, so every edge case comes up. */
function samples(alphabet: string, count = 5000, maxLength = 12): string[] {
	let seed = 42;
	const random = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
		return seed / 2 ** 31;
	};
	return Array.from({ length: count }, () => {
		const length = Math.floor(random() * maxLength);
		return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
	});
}

/** Big enough that the old regexes took seconds; the helpers must stay near-instant. */
const HOSTILE = 50_000;

function assertFast(run: () => unknown) {
	const started = performance.now();
	run();
	assert.ok(performance.now() - started < 200, 'took too long — backtracking is back');
}

describe('text helpers match the regexes they replace', () => {
	test('trimTrailing', () => {
		for (const value of samples('a=/).,')) {
			assert.equal(trimTrailing(value, '='), value.replace(/=+$/, ''), value);
			assert.equal(trimTrailing(value, ').,'), value.replace(/[).,]+$/, ''), value);
		}
		assertFast(() => trimTrailing('='.repeat(HOSTILE) + 'x', '='));
	});

	test('stripTags', () => {
		for (const value of samples('ab<> ')) {
			assert.equal(stripTags(value), value.split(/<[^>]+>/).join(''), value);
		}
		assertFast(() => stripTags('<'.repeat(HOSTILE)));
	});

	test('removeElements drops whole elements, however the close tag is written', () => {
		assert.equal(removeElements('a<script>x()</script>b', 'script'), 'ab');
		assert.equal(removeElements('a<SCRIPT type="t">x</Script >b', 'script'), 'ab');
		assert.equal(removeElements('a<style>p{}</style>b<style>q{}</style>c', 'style'), 'abc');
		assert.equal(removeElements('a<script>never closed', 'script'), 'a');
		assert.equal(removeElements('a<scripts>b', 'script'), 'a<scripts>b');
		assertFast(() => removeElements('<script'.repeat(HOSTILE / 7), 'script'));
		assertFast(() => removeElements('<script></script'.repeat(HOSTILE / 16), 'script'));
	});

	test('stripHtml stays linear on unclosed tags and decodes &amp; last', () => {
		assert.equal(stripHtml('<p>a &amp;lt; b</p><br>c'), 'a &lt; b\n\nc');
		assertFast(() => stripHtml('<'.repeat(HOSTILE)));
	});

	test('firstAngled', () => {
		for (const value of samples('ab<> ')) {
			assert.equal(firstAngled(value), value.match(/<([^>]+)>/)?.[1] ?? null, value);
		}
		assertFast(() => firstAngled('<'.repeat(HOSTILE)));
	});

	test('splitTrailingAngled', () => {
		for (const value of samples('ab<> ')) {
			const match = value.match(/^(.*?)<([^>]+)>$/);
			const expected = match ? { before: match[1], inside: match[2] } : null;
			assert.deepEqual(splitTrailingAngled(value), expected, value);
		}
		assertFast(() => splitTrailingAngled('<'.repeat(HOSTILE) + '>'));
	});

	test('firstEmailLike', () => {
		for (const value of samples('ab@<> \t')) {
			assert.equal(firstEmailLike(value), value.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? null, value);
		}
		assertFast(() => firstEmailLike('a'.repeat(HOSTILE)));
	});
});
