import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { captionLanguages, languageNames } from '../caption-language';

describe('captionLanguages', () => {
	test('nothing, or nothing known, leaves the guess to Whisper', () => {
		assert.deepEqual(captionLanguages(null), []);
		assert.deepEqual(captionLanguages(''), []);
		assert.deepEqual(captionLanguages('auto'), []);
		assert.deepEqual(captionLanguages('xx,zz'), []);
	});

	test('keeps known codes in the order picked, without repeats', () => {
		assert.deepEqual(captionLanguages('id'), ['id']);
		assert.deepEqual(captionLanguages('ja, en ,xx,ja'), ['ja', 'en']);
	});

	test('stops at three', () => {
		assert.deepEqual(captionLanguages('en,id,ja,ko'), ['en', 'id', 'ja']);
	});
});

describe('languageNames', () => {
	test('names languages in the reader’s locale', () => {
		assert.equal(languageNames('en')('id'), 'Indonesian');
		assert.equal(languageNames('id')('id'), 'Indonesia');
	});
});
