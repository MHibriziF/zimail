import type { R2Bucket } from '@cloudflare/workers-types';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * R2's API over a folder, for running off Cloudflare. Only what the app uses:
 * `put` of bytes, `get` (body, bytes, size, etag) and `delete`. Keys are paths
 * under `root`, such as `<emailId>/<attachmentId>/<name>`.
 */

type PutValue = ArrayBuffer | ArrayBufferView | string | null;

function toBytes(value: PutValue): Uint8Array {
	if (value === null) return new Uint8Array();
	if (typeof value === 'string') return new TextEncoder().encode(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function isMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export function createFsBucket(root: string): R2Bucket {
	const base = resolve(root);

	/** Keys come from our own code, but a `..` must still never leave the folder. */
	function pathOf(key: string): string {
		const path = resolve(base, key);
		if (!key || !path.startsWith(base + sep)) throw new Error(`Invalid storage key: ${key}`);
		return path;
	}

	async function get(key: string) {
		const path = pathOf(key);
		let bytes: Buffer;
		let mtimeMs: number;
		try {
			[bytes, { mtimeMs }] = await Promise.all([readFile(path), stat(path)]);
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
		const etag = `${bytes.byteLength.toString(16)}-${Math.floor(mtimeMs).toString(16)}`;
		const view = new Uint8Array(bytes);
		return {
			key,
			size: view.byteLength,
			etag,
			httpEtag: `"${etag}"`,
			get body() {
				return new Response(view).body;
			},
			arrayBuffer: async () => view.slice().buffer,
			text: async () => new TextDecoder().decode(view)
		};
	}

	return {
		get,

		async put(key: string, value: PutValue) {
			const path = pathOf(key);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, toBytes(value));
			return get(key);
		},

		async delete(keys: string | string[]) {
			const all = Array.isArray(keys) ? keys : [keys];
			await Promise.all(all.map((key) => rm(pathOf(key), { force: true })));
		}
	} as unknown as R2Bucket;
}
