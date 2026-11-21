import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsHtmlMode } from '../editor-html';

test('a fragment the editor can hold stays in the editor', () => {
	assert.equal(needsHtmlMode('<p>Hi <b>there</b></p><table><tr><td>x</td></tr></table>'), false);
	assert.equal(needsHtmlMode('<p>Use the &lt;style&gt; tag</p>'), false);
});

test('styles or a whole page keep the body in HTML mode', () => {
	assert.equal(needsHtmlMode('<style>p{color:red}</style><p>Hi</p>'), true);
	assert.equal(needsHtmlMode('<!doctype html><html><head></head><body><p>Hi</p></body></html>'), true);
	assert.equal(needsHtmlMode('<BODY style="margin:0"><p>Hi</p></BODY>'), true);
});
