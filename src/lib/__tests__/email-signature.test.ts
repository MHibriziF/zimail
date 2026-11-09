import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	assertSignatureLength,
	composerBody,
	hasSignatureBlock,
	MAX_EMAIL_SIGNATURE_LENGTH,
	normalizeEmailSignature,
	pickEmailSignature,
	signatureAsHtml,
	signatureBlockHtml
} from '../email-signature';

describe('email signatures', () => {
	test('normalizes line endings and trailing whitespace', () => {
		assert.equal(normalizeEmailSignature('  Best,  \r\nEmmanuel  \r\n'), 'Best,\nEmmanuel');
	});

	test('picks a mailbox signature over the account signature', () => {
		assert.equal(pickEmailSignature('Support', 'Best,<br>Emmanuel'), 'Support');
		assert.equal(pickEmailSignature('  ', 'Best,<br>Emmanuel'), 'Best,<br>Emmanuel');
		assert.equal(pickEmailSignature(null, ''), '');
	});

	test('rejects signatures over the character limit', () => {
		assert.doesNotThrow(() => assertSignatureLength('x'.repeat(MAX_EMAIL_SIGNATURE_LENGTH)));
		assert.throws(() => assertSignatureLength('x'.repeat(MAX_EMAIL_SIGNATURE_LENGTH + 1)), /10000 characters or fewer/);
	});
});

describe('signatureAsHtml', () => {
	test('keeps HTML as it is', () => {
		assert.equal(signatureAsHtml('<div>Best,<br><b>Ana</b></div>'), '<div>Best,<br><b>Ana</b></div>');
	});

	test('turns plain text into HTML that keeps its line breaks', () => {
		assert.equal(signatureAsHtml('Best,\r\nAna & Co'), 'Best,<br>Ana &amp; Co');
	});

	test('a < that starts no tag is text', () => {
		assert.equal(signatureAsHtml('I <3 mail\n2 < 3'), 'I &lt;3 mail<br>2 &lt; 3');
		assert.equal(signatureAsHtml('Ana <ana@x.co>'), 'Ana &lt;ana@x.co&gt;');
	});

	test('a closing tag or comment alone is enough to mean HTML', () => {
		assert.equal(signatureAsHtml('Ana</div>'), 'Ana</div>');
		assert.equal(signatureAsHtml('<!-- x -->Ana'), '<!-- x -->Ana');
	});
});

describe('composerBody', () => {
	test('leaves a line to write on above the signature', () => {
		assert.equal(
			composerBody('Izi<br><b>Zimail</b>'),
			'<div><br></div><div><br></div><div data-email-signature="true">Izi<br><b>Zimail</b></div>'
		);
	});

	test('keeps a body that is already there', () => {
		assert.match(composerBody('Izi', '<p>Hi</p>'), /^<p>Hi<\/p><div><br><\/div><div data-email-signature/);
	});

	test('without a signature the body is untouched', () => {
		assert.equal(composerBody('  '), '');
		assert.equal(composerBody('', '<p>Hi</p>'), '<p>Hi</p>');
	});

	test('the block is recognisable again', () => {
		assert.ok(hasSignatureBlock(composerBody('<b>me</b>')));
		assert.equal(signatureBlockHtml(''), '');
	});
});
