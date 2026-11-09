import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_EMAIL_SIGNATURE_LENGTH } from '$lib/email-signature';
import { cleanSignature, sanitizeSignatureHtml } from '../signature-html';

describe('cleanSignature', () => {
	test('stores plain text from an API client as HTML with its line breaks', async () => {
		assert.equal(await cleanSignature('Best,\nAna <ana@x.co>'), 'Best,<br>Ana &lt;ana@x.co&gt;');
	});

	test('sanitizes HTML and rejects one that is too long', async () => {
		assert.equal(await cleanSignature('<b onclick="x">Ana</b>'), '<b>Ana</b>');
		await assert.rejects(cleanSignature('x'.repeat(MAX_EMAIL_SIGNATURE_LENGTH + 1)), /characters or fewer/);
	});
});

describe('sanitizeSignatureHtml', () => {
	test('keeps a typical signature as it is', async () => {
		const html =
			'<div>Best regards,<br><b>Ana</b></div><table cellpadding="0"><tr><td><img src="https://mail.example/sig/a.png" width="120" alt="Logo"></td>' +
			'<td style="color: #555; font-size: 12px"><a href="https://example.com" target="_blank" rel="noopener">example.com</a></td></tr></table>';
		assert.equal(await sanitizeSignatureHtml(html), html);
	});

	test('removes scripts, styles and frames with their content', async () => {
		const html = '<p>Hi</p><script>alert(1)</script><style>p{}</style><iframe src="https://x"></iframe><svg><script>1</script></svg>';
		assert.equal(await sanitizeSignatureHtml(html), '<p>Hi</p>');
	});

	test('removes event handlers and unknown attributes', async () => {
		const clean = await sanitizeSignatureHtml('<img src="https://x/a.png" onerror="alert(1)" class="c" data-x="1"><p onclick="x" id="y">Hi</p>');
		assert.equal(clean, '<img src="https://x/a.png"><p>Hi</p>');
	});

	test('only keeps web, mail and phone links', async () => {
		const clean = await sanitizeSignatureHtml(
			'<a href="javascript:alert(1)">a</a><a href=" jav\tascript:alert(1)">b</a><a href="data:text/html,x">c</a>' +
				'<a href="mailto:a@b.c">d</a><a href="tel:+62">e</a><a href="jav&#97;script:alert(1)">f</a>'
		);
		assert.equal(clean, 'abc<a href="mailto:a@b.c">d</a><a href="tel:+62">e</a>f');
	});

	test('drops images that are not on the web, such as pasted local files', async () => {
		const clean = await sanitizeSignatureHtml('<img src="cid:image001.png@01D"><img src="file:///C:/logo.png"><img src="data:image/png;base64,AA"><img>');
		assert.equal(clean, '');
	});

	test('drops styles that can run code or fetch', async () => {
		const clean = await sanitizeSignatureHtml(
			'<span style="width: expression(alert(1))">a</span><span style="background: url(https://t/x)">b</span><span style="color:red">c</span>'
		);
		assert.equal(clean, '<span>a</span><span>b</span><span style="color:red">c</span>');
	});

	test('unwraps unknown tags but keeps their text, and drops comments', async () => {
		const clean = await sanitizeSignatureHtml('<o:p>Office</o:p><custom-tag>text</custom-tag><!-- note --><section>x</section>');
		assert.equal(clean, 'Officetextx');
	});

	test('a link opening in a new tab cannot reach back to the page', async () => {
		assert.equal(
			await sanitizeSignatureHtml('<a href="https://x" target="_top">x</a>'),
			'<a href="https://x" target="_blank" rel="noopener">x</a>'
		);
	});

	test('an unfinished tag at the end stays text, so markup written after it cannot complete it', async () => {
		assert.equal(
			await sanitizeSignatureHtml('Hi <img src="https://x" onerror="alert(1)"'),
			'Hi &lt;img src="https://x" onerror="alert(1)"'
		);
		assert.equal(await sanitizeSignatureHtml('<b>Hi</b> <!-- open'), '<b>Hi</b>');
	});
});
