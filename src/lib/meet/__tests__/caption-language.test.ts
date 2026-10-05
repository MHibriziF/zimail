import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { captionLanguageLabel, captionLanguages } from '../caption-language';

describe('captionLanguages', () => {
	test('auto, missing and unknown choices leave the guess to Whisper', () => {
		assert.deepEqual(captionLanguages('auto'), []);
		assert.deepEqual(captionLanguages(null), []);
		assert.deepEqual(captionLanguages('xx'), []);
		assert.deepEqual(captionLanguages('en+xx'), []);
	});

	test('one language, or the English and Indonesian pair', () => {
		assert.deepEqual(captionLanguages('id'), ['id']);
		assert.deepEqual(captionLanguages('en+id'), ['en', 'id']);
	});
});

describe('captionLanguageLabel', () => {
	test('names languages in the reader’s locale and joins a pair', () => {
		assert.equal(captionLanguageLabel('auto', 'en', 'Detect'), 'Detect');
		assert.equal(captionLanguageLabel('en+id', 'en', 'Detect'), 'English + Indonesian');
		assert.equal(captionLanguageLabel('id', 'id', 'Deteksi'), 'Indonesia');
	});
});
