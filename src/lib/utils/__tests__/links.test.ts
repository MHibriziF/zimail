import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { linkHtml, normalizeLinkUrl } from '../links';

describe('normalizeLinkUrl', () => {
	test('keeps a full web address', () => {
		assert.equal(normalizeLinkUrl('https://zimail.app/path?q=1'), 'https://zimail.app/path?q=1');
	});

	test('adds https to a bare address', () => {
		assert.equal(normalizeLinkUrl(' zimail.app '), 'https://zimail.app/');
		assert.equal(normalizeLinkUrl('//zimail.app/x'), 'https://zimail.app/x');
	});

	test('turns an email into a mailto link', () => {
		assert.equal(normalizeLinkUrl('me@example.com'), 'mailto:me@example.com');
		assert.equal(normalizeLinkUrl('mailto:me@example.com'), 'mailto:me@example.com');
	});

	test('accepts phone links', () => {
		assert.equal(normalizeLinkUrl('tel:+62812345'), 'tel:+62812345');
	});

	test('refuses anything that could run or embed', () => {
		assert.equal(normalizeLinkUrl('javascript:alert(1)'), null);
		assert.equal(normalizeLinkUrl('JavaScript:alert(1)'), null);
		assert.equal(normalizeLinkUrl('data:text/html,hi'), null);
		assert.equal(normalizeLinkUrl('vbscript:x'), null);
	});

	test('refuses empty, spaced or host-less input', () => {
		assert.equal(normalizeLinkUrl('   '), null);
		assert.equal(normalizeLinkUrl('not a link'), null);
		assert.equal(normalizeLinkUrl('hello'), null);
	});
});

describe('linkHtml', () => {
	test('escapes the address and the text', () => {
		assert.equal(
			linkHtml('https://x.com/?a=1&b="2"', '<b>hi</b>'),
			'<a href="https://x.com/?a=1&amp;b=&quot;2&quot;">&lt;b&gt;hi&lt;/b&gt;</a>'
		);
	});

	test('falls back to the address when there is no text', () => {
		assert.equal(linkHtml('https://x.com/', ''), '<a href="https://x.com/">https://x.com/</a>');
	});
});
