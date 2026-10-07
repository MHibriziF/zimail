import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { captionLanguage, languageNames } from '../caption-language';

describe('captionLanguage', () => {
	test('a known code is kept', () => {
		assert.equal(captionLanguage('id'), 'id');
		assert.equal(captionLanguage(' en '), 'en');
	});

	test('nothing, or anything unknown, leaves the guess to Whisper', () => {
		assert.equal(captionLanguage(null), '');
		assert.equal(captionLanguage(''), '');
		assert.equal(captionLanguage('auto'), '');
		assert.equal(captionLanguage('en,id'), '');
	});
});

describe('languageNames', () => {
	test('names languages in the reader’s locale', () => {
		assert.equal(languageNames('en')('id'), 'Indonesian');
		assert.equal(languageNames('id')('id'), 'Indonesia');
	});
});
