import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inlineContentType, isInlineImageType, isPreviewableInline } from '../attachments';

describe('inlineContentType', () => {
	test('allows only the listed types', () => {
		assert.equal(inlineContentType('image/png'), 'image/png');
		assert.equal(inlineContentType('application/pdf'), 'application/pdf');
		assert.equal(inlineContentType('text/plain'), 'text/plain; charset=utf-8');
		for (const type of ['text/html', 'image/svg+xml', 'text/xml', 'application/json', 'text/csv', '']) {
			assert.equal(inlineContentType(type), null, type);
		}
	});

	test('ignores case and parameters but not the base type', () => {
		assert.equal(inlineContentType(' Image/GIF; name="a.gif"'), 'image/gif');
		assert.equal(inlineContentType('text/html; charset=x'), null);
		assert.equal(isPreviewableInline('text/plain; charset=x'), true);
	});
});

describe('isInlineImageType', () => {
	test('is true only for an image served inline', () => {
		assert.equal(isInlineImageType('image/webp'), true);
		assert.equal(isInlineImageType('image/svg+xml'), false);
		assert.equal(isInlineImageType('application/pdf'), false);
	});
});
