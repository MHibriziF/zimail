import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { R2Bucket } from '@cloudflare/workers-types';
import {
	detectImageType,
	isSignatureImageName,
	MAX_SIGNATURE_IMAGE_BYTES,
	saveSignatureImage,
	signatureImageResponse
} from '../signature-images';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

function memoryBucket() {
	const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
	const bucket = {
		async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
			objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType });
		},
		async get(key: string) {
			const object = objects.get(key);
			if (!object) return null;
			return { body: new Blob([new Uint8Array(object.bytes)]).stream(), size: object.bytes.byteLength, httpEtag: '"e1"' };
		}
	};
	return { bucket: bucket as unknown as R2Bucket, objects };
}

describe('detectImageType', () => {
	test('reads the type from the bytes', () => {
		assert.equal(detectImageType(PNG), 'png');
		assert.equal(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
		assert.equal(detectImageType(new TextEncoder().encode('GIF89a')), 'gif');
		assert.equal(detectImageType(WEBP), 'webp');
	});

	test('refuses anything else, SVG included', () => {
		assert.equal(detectImageType(new TextEncoder().encode('<svg onload="alert(1)">')), null);
		assert.equal(detectImageType(new TextEncoder().encode('<html>')), null);
		assert.equal(detectImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])), null);
	});
});

describe('saveSignatureImage', () => {
	test('stores an image under a random name with its real type', async () => {
		const { bucket, objects } = memoryBucket();
		const saved = await saveSignatureImage(bucket, PNG);
		assert.ok(saved.ok);
		assert.ok(isSignatureImageName(saved.name), saved.name);
		assert.equal(objects.get(`signature-images/${saved.name}`)?.contentType, 'image/png');
	});

	test('rejects empty, oversized and non-image files', async () => {
		const { bucket, objects } = memoryBucket();
		assert.deepEqual(await saveSignatureImage(bucket, new Uint8Array()), { ok: false, error: 'empty' });
		const big = new Uint8Array(MAX_SIGNATURE_IMAGE_BYTES + 1);
		big.set(PNG);
		assert.deepEqual(await saveSignatureImage(bucket, big), { ok: false, error: 'too_large' });
		assert.deepEqual(await saveSignatureImage(bucket, new TextEncoder().encode('hello')), { ok: false, error: 'not_an_image' });
		assert.equal(objects.size, 0);
	});
});

describe('signatureImageResponse', () => {
	test('serves a stored image to be cached for good, and nothing that could run', async () => {
		const { bucket } = memoryBucket();
		const saved = await saveSignatureImage(bucket, PNG);
		assert.ok(saved.ok);
		const response = await signatureImageResponse(bucket, saved.name);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-type'), 'image/png');
		assert.match(response.headers.get('cache-control') ?? '', /immutable/);
		assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
		assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
	});

	test('answers 404 for unknown names and never reads outside its folder', async () => {
		const { bucket } = memoryBucket();
		assert.equal((await signatureImageResponse(bucket, '00000000-0000-0000-0000-000000000000.png')).status, 404);
		assert.equal((await signatureImageResponse(bucket, '../attachments/secret.pdf')).status, 404);
		assert.equal(isSignatureImageName('a.png'), false);
	});
});
