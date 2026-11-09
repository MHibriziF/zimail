import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import english from 'emojibase-data/en/compact.json';
import chinese from 'emojibase-data/zh/compact.json';
import versions from 'emojibase-data/versions/emoji.json';
import {
	BASELINE_EMOJI_VERSION,
	buildEmojiData,
	emojiUpTo,
	newestSupportedVersion,
	RECENT_EMOJI_LIMIT,
	rememberEmoji,
	searchEmoji,
	type EmojibaseEntry
} from '../emoji';

const en = buildEmojiData(english as EmojibaseEntry[], null, versions);
const zh = buildEmojiData(chinese as EmojibaseEntry[], english as EmojibaseEntry[], versions);
const all = emojiUpTo(en, Infinity);

describe('buildEmojiData', () => {
	test('keeps every emoji once, and no skin-tone components', () => {
		const chars = en.rows.map(([char]) => char);
		assert.ok(chars.length > 1800);
		assert.equal(new Set(chars).size, chars.length);
		assert.ok(!chars.includes('🏻'));
	});

	test('every emoji has a known version and search words', () => {
		for (const [char, , version, name] of en.rows) {
			assert.ok(version > 0, char);
			assert.ok(name.length > 0, char);
		}
	});

	test('probes one plain emoji per newer version, newest first', () => {
		const probed = en.probes.map(([version]) => version);
		assert.ok(probed.every((version) => version > BASELINE_EMOJI_VERSION));
		assert.deepEqual(probed, [...probed].sort((a, b) => b - a));
		assert.ok(en.probes.every(([, char]) => [...char].length <= 2));
	});

	test('adds English words to another language', () => {
		const people = emojiUpTo(zh, Infinity);
		assert.ok(searchEmoji(people, 'pizza').some((item) => item.char === '🍕'));
		assert.ok(searchEmoji(people, '披萨', true).some((item) => item.char === '🍕'));
	});
});

describe('version support', () => {
	test('picks the newest version the device draws', () => {
		const supported = new Set(en.probes.slice(1).map(([, char]) => char));
		assert.equal(newestSupportedVersion(en.probes, (char) => supported.has(char)), en.probes[1][0]);
	});

	test('falls back to the baseline when nothing newer draws', () => {
		assert.equal(newestSupportedVersion(en.probes, () => false), BASELINE_EMOJI_VERSION);
	});

	test('leaves out emoji newer than the device draws', () => {
		const old = emojiUpTo(en, BASELINE_EMOJI_VERSION);
		assert.ok(old.length < all.length);
		assert.ok(old.some((item) => item.char === '😀'));
	});
});

describe('searchEmoji', () => {
	test('needs every word typed to match the start of a word', () => {
		const found = searchEmoji(all, 'thumbs up').map((item) => item.char);
		assert.ok(found.includes('👍'));
		assert.ok(!found.includes('👎'));
	});

	test('puts emoji named by the search ahead of ones only tagged with it', () => {
		assert.equal(searchEmoji(all, 'pizza')[0].char, '🍕');
		assert.equal(searchEmoji(emojiUpTo(zh, Infinity), 'pizza')[0].char, '🍕');
	});

	test('ignores case and finds nothing for an empty query', () => {
		assert.ok(searchEmoji(all, 'PIZZA').some((item) => item.char === '🍕'));
		assert.deepEqual(searchEmoji(all, '   '), []);
	});

	test('finds flags by country', () => {
		assert.ok(searchEmoji(all, 'indonesia').some((item) => item.category === 'flags'));
	});
});

describe('rememberEmoji', () => {
	test('moves a repeat to the front', () => {
		assert.deepEqual(rememberEmoji(['😀', '👍', '🎉'], '🎉'), ['🎉', '😀', '👍']);
	});

	test('keeps the list capped', () => {
		const full = Array.from({ length: RECENT_EMOJI_LIMIT }, (_, index) => String(index));
		const next = rememberEmoji(full, '🔥');
		assert.equal(next.length, RECENT_EMOJI_LIMIT);
		assert.equal(next[0], '🔥');
	});
});
