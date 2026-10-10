import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { storedFileHeaders } from '../file-response';

function headersFor(contentType: string, allowInline = true) {
	return storedFileHeaders({
		contentType,
		size: 10,
		cacheControl: 'private, max-age=3600',
		filename: 'file',
		allowInline
	});
}

describe('storedFileHeaders', () => {
	test('downloads an HTML attachment as opaque bytes', () => {
		const headers = headersFor('text/html');
		assert.equal(headers['Content-Disposition'], 'attachment; filename="file"');
		assert.equal(headers['Content-Type'], 'application/octet-stream');
		assert.equal(headers['X-Content-Type-Options'], 'nosniff');
	});

	test('downloads an SVG attachment as opaque bytes', () => {
		const headers = headersFor('image/svg+xml');
		assert.equal(headers['Content-Disposition'], 'attachment; filename="file"');
		assert.equal(headers['Content-Type'], 'application/octet-stream');
		assert.equal(headers['X-Content-Type-Options'], 'nosniff');
	});

	test('does not mistake HTML with a charset for plain text', () => {
		const headers = headersFor('text/html; charset=x');
		assert.equal(headers['Content-Disposition'], 'attachment; filename="file"');
		assert.equal(headers['Content-Type'], 'application/octet-stream');
	});

	test('shows a PNG inline', () => {
		const headers = headersFor('image/png');
		assert.equal(headers['Content-Disposition'], 'inline; filename="file"');
		assert.equal(headers['Content-Type'], 'image/png');
		assert.equal(headers['X-Content-Type-Options'], 'nosniff');
	});

	test('normalizes an allowlisted type rather than echoing the stored string', () => {
		assert.equal(headersFor('IMAGE/JPEG; name="a.jpg"')['Content-Type'], 'image/jpeg');
		assert.equal(headersFor('text/plain; charset=iso-8859-1')['Content-Type'], 'text/plain; charset=utf-8');
	});

	test('downloads an allowlisted type when asked to', () => {
		const headers = headersFor('image/png', false);
		assert.equal(headers['Content-Disposition'], 'attachment; filename="file"');
		assert.equal(headers['Content-Type'], 'application/octet-stream');
	});

	test('sandboxes every response', () => {
		for (const type of ['image/png', 'text/html', 'application/pdf']) {
			assert.match(headersFor(type)['Content-Security-Policy'], /default-src 'none'.*sandbox/);
		}
	});

	test('omits the filename when none is given', () => {
		const headers = storedFileHeaders({ contentType: 'image/webp', size: 1, cacheControl: 'no-store' });
		assert.equal(headers['Content-Disposition'], 'inline');
	});
});
