import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHtmlEmail } from '../send-mail';

test('a whole page is sent as written, not nested in another', () => {
	const page = '<!doctype html><html><head><style>p{color:red}</style></head><body><p>Hi</p></body></html>';
	assert.equal(buildHtmlEmail(page), page);
});

test('a fragment is still wrapped in a document', () => {
	const sent = buildHtmlEmail('<p>Hi</p>');
	assert.match(sent, /^<!DOCTYPE html>/);
	assert.match(sent, /<body[^>]*>\n<p>Hi<\/p>\n<\/body>/);
});
