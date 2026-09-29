import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { finishHead } from '../page-head';

const defaults = { image: 'https://mail.example/icons/icon-512.png', siteName: 'Zimail' };
const page = (head: string) =>
	`<html><head>\n\t<title id="fallback-title">Zimail</title>\n\t${head}\n</head><body></body></html>`;
const titles = (html: string) => [...html.matchAll(/<title[^>]*>([^<]*)<\/title>/g)].map((match) => match[1]);
const meta = (html: string, property: string) =>
	html.match(new RegExp(`property="${property}" content="([^"]*)"`))?.[1] ?? null;

describe('finishHead', () => {
	test('a page with its own title keeps only that one', () => {
		const html = finishHead(page('<link rel="stylesheet" href="/a.css"><title>Demo TI — Zimail</title>'), defaults);
		assert.deepEqual(titles(html), ['Demo TI — Zimail']);
		assert.equal(meta(html, 'og:title'), 'Demo TI — Zimail');
	});

	test('a client-rendered page keeps the fallback, retitled when asked', () => {
		assert.deepEqual(titles(finishHead(page(''), defaults)), ['Zimail']);
		const meeting = finishHead(page(''), { ...defaults, fallbackTitle: 'Meeting — Zimail' });
		assert.deepEqual(titles(meeting), ['Meeting — Zimail']);
		assert.equal(meta(meeting, 'og:title'), 'Meeting — Zimail');
	});

	test('adds the image, site name and card with an absolute image URL', () => {
		const html = finishHead(page('<title>Inbox</title>'), defaults);
		assert.equal(meta(html, 'og:image'), defaults.image);
		assert.equal(meta(html, 'og:site_name'), 'Zimail');
		assert.equal(meta(html, 'og:type'), 'website');
		assert.match(html, /name="twitter:card" content="summary"/);
	});

	test('tags a page set itself are left alone and not duplicated', () => {
		const html = finishHead(
			page('<title>Book</title><meta property="og:title" content="Office hours" /><meta property="og:description" content="Pick a time" />'),
			defaults
		);
		assert.equal(html.match(/property="og:title"/g)?.length, 1);
		assert.equal(meta(html, 'og:title'), 'Office hours');
	});

	test('a $& in the fallback title is kept as text', () => {
		assert.deepEqual(titles(finishHead(page(''), { ...defaults, fallbackTitle: 'Pay $& go' })), ['Pay $& go']);
	});

	test('quotes in a title cannot break out of the attribute', () => {
		const html = finishHead(page('<title>Say "hi"</title>'), defaults);
		assert.equal(meta(html, 'og:title'), 'Say &quot;hi&quot;');
	});

	test('an SVG <title> in the body is not mistaken for the page title', () => {
		const html = finishHead(page('').replace('<body>', '<body><svg><title>Logo</title></svg>'), defaults);
		assert.deepEqual(titles(html.slice(0, html.indexOf('</head>'))), ['Zimail']);
	});

	test('a chunk without the head is passed through untouched', () => {
		assert.equal(finishHead('<div>body chunk</div>', defaults), '<div>body chunk</div>');
	});
});
