import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { appendEmailSignature } from '../append-signature';

describe('appendEmailSignature', () => {
	test('appends the HTML signature, and its text to the plain part', () => {
		assert.deepEqual(
			appendEmailSignature({
				text: 'Hello there',
				html: '<p>Hello there</p>',
				signature: '<div>Best,<br><b>Emmanuel</b> &amp; Co</div><img src="https://x/logo.png" alt="Logo">'
			}),
			{
				text: 'Hello there\n\nBest,\nEmmanuel & Co',
				html:
					'<p>Hello there</p>\n<div><br></div>\n<div data-email-signature="true"><div>Best,<br><b>Emmanuel</b> &amp; Co</div><img src="https://x/logo.png" alt="Logo"></div>'
			}
		);
	});

	test('leaves the message unchanged when the signature is empty', () => {
		assert.deepEqual(appendEmailSignature({ text: 'Hello', html: '<p>Hello</p>', signature: '   ' }), {
			text: 'Hello',
			html: '<p>Hello</p>'
		});
	});
});
