import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildEmailDocument, isRichHtml, supportsDarkScheme } from '../email-html';

describe('isRichHtml: did the sender style it?', () => {
	test('plain writing is not styled', () => {
		for (const html of [
			'<p>Hi Ana,</p><p>See you <a href="https://x.test">there</a>.<br>Izi</p>',
			'<div dir="ltr">Thanks!</div>',
			'<p style="text-align: center">Centred, but no colours or fonts</p>'
		]) {
			assert.equal(isRichHtml(html), false, html);
		}
	});

	test('any colour, background or font the sender chose counts', () => {
		for (const html of [
			'<p>Hello <span style="color:#c00">in red</span></p>',
			'<p style="font-family: Georgia">Serif on purpose</p>',
			'<p><span style="background-color: yellow">highlighted</span></p>',
			'<p><font color="blue">old-school</font></p>',
			'<table><tr><td>laid out</td></tr></table>',
			'<style>p { color: navy }</style><p>stylesheet</p>'
		]) {
			assert.equal(isRichHtml(html), true, html);
		}
	});

	test('styling only in the quoted history does not make a plain reply styled', () => {
		const reply = `<p>Sounds good — see you Monday.</p><blockquote><p style="color:#333;font-family:Georgia">earlier message</p></blockquote>`;
		assert.equal(isRichHtml(reply), false);
	});

	test('a long unstyled message is judged quickly', () => {
		const started = performance.now();
		isRichHtml(`<p>${'style= word '.repeat(20_000)}</p>`);
		assert.ok(performance.now() - started < 200);
	});
});

describe('buildEmailDocument', () => {
	const styled = '<html><head><style>body { font-family: Georgia; color: #123456 }</style></head><body><p>Designed</p></body></html>';

	test('our defaults go before the sender’s stylesheet, so theirs wins', () => {
		const doc = buildEmailDocument(styled, { rich: true, theme: 'light' });
		const ourDefaults = doc.indexOf('font: 14px/1.5 Arial');
		const theirs = doc.indexOf('font-family: Georgia');
		assert.ok(ourDefaults !== -1 && theirs !== -1);
		assert.ok(ourDefaults < theirs, 'defaults first');
	});

	test('a styled message gets none of the app’s typography, and its colours are never rewritten', () => {
		const html = '<table bgcolor="#ffffff"><tr><td style="color:#000000;background:#fafafa">Hi</td></tr></table>';
		const doc = buildEmailDocument(html, { rich: true, theme: 'dark' });
		assert.ok(!doc.includes('font-size: 15px'));
		assert.ok(!doc.includes('line-height: 1.65'));
		assert.ok(doc.includes('style="color:#000000;background:#fafafa"'));
		assert.ok(doc.includes('bgcolor="#ffffff"'));
	});

	test('a plain message still reads in the app’s type and colours', () => {
		const doc = buildEmailDocument('<p>Hi</p>', { rich: false, theme: 'dark' });
		assert.ok(doc.includes('font-size: 15px'));
		assert.ok(doc.includes(":root[data-theme='dark'] body"));
		assert.match(doc, /<html data-theme="dark">/);
	});

	test('without a dark version the light page is declared outright, not through a media query', () => {
		const doc = buildEmailDocument(styled, { rich: true, theme: 'dark' });
		const defaults = doc.slice(0, doc.indexOf('font-family: Georgia'));
		assert.match(defaults, /html \{ color-scheme: light; \}\s*body \{ color: #202124; background: #ffffff; \}/);
		assert.ok(!defaults.includes('prefers-color-scheme'));
		const darkReady = buildEmailDocument(
			'<html><head><style>@media (prefers-color-scheme: dark) { body { background: #000 } }</style></head><body>x</body></html>',
			{ rich: true, theme: 'dark' }
		);
		assert.ok(darkReady.includes('@media (prefers-color-scheme: dark)'));
	});

	test('the frame rules come last, after anything the sender wrote', () => {
		const doc = buildEmailDocument(styled, { rich: true });
		assert.ok(doc.indexOf('.quote-hidden') > doc.indexOf('font-family: Georgia'));
	});
});

describe('supportsDarkScheme', () => {
	test('only a real dark design counts', () => {
		assert.equal(supportsDarkScheme('<style>@media (prefers-color-scheme: dark) { body { background: #000 } }</style>'), true);
		assert.equal(supportsDarkScheme('<style>body { color: light-dark(#000, #fff) }</style>'), true);
		assert.equal(supportsDarkScheme('<meta name="color-scheme" content="light dark">'), false);
	});
});
