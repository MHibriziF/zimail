import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Images in signatures (a logo, social icons), served publicly at /sig/<name>. They must be public:
 * the recipient's mail app fetches them without signing in, and Gmail through its image proxy.
 * The random name is the only thing that finds one. They are never deleted, because mail already
 * sent keeps pointing at them.
 */
export const SIGNATURE_IMAGE_PATH = '/sig/';
export const MAX_SIGNATURE_IMAGE_BYTES = 1024 * 1024;

const KEY_PREFIX = 'signature-images/';

/** SVG is left out on purpose: it can carry script. */
const IMAGE_TYPES = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp'
} as const;

export type SignatureImageType = keyof typeof IMAGE_TYPES;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
	return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The image type from the file's own bytes, never from what the browser claims it is. */
export function detectImageType(bytes: Uint8Array): SignatureImageType | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
	if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
	return null;
}

const NAME_PATTERN = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

export function isSignatureImageName(name: string): boolean {
	return NAME_PATTERN.test(name);
}

export type SignatureImageUpload =
	| { ok: true; name: string }
	| { ok: false; error: 'too_large' | 'not_an_image' | 'empty' };

export async function saveSignatureImage(bucket: R2Bucket, bytes: Uint8Array): Promise<SignatureImageUpload> {
	if (bytes.byteLength === 0) return { ok: false, error: 'empty' };
	if (bytes.byteLength > MAX_SIGNATURE_IMAGE_BYTES) return { ok: false, error: 'too_large' };
	const type = detectImageType(bytes);
	if (!type) return { ok: false, error: 'not_an_image' };
	const name = `${crypto.randomUUID()}.${type}`;
	await bucket.put(`${KEY_PREFIX}${name}`, bytes, { httpMetadata: { contentType: IMAGE_TYPES[type] } });
	return { ok: true, name };
}

export async function signatureImageResponse(bucket: R2Bucket, name: string): Promise<Response> {
	const object = isSignatureImageName(name) ? await bucket.get(`${KEY_PREFIX}${name}`) : null;
	if (!object) return new Response('Not found', { status: 404 });
	const type = IMAGE_TYPES[name.slice(name.lastIndexOf('.') + 1) as SignatureImageType];
	return new Response(object.body as unknown as ReadableStream, {
		headers: {
			'Content-Type': type,
			'Content-Length': String(object.size),
			// A name is never reused, so a copy is good forever.
			'Cache-Control': 'public, max-age=31536000, immutable',
			ETag: object.httpEtag,
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'"
		}
	});
}
