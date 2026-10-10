import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CallBackgroundsRepository, NewCallBackground, StoredCallBackground } from '../repository';
import { createCallBackgroundsService } from '../service';

/** In-memory `CallBackgroundsRepository` — a plain array standing in for D1 + R2 together. */
function fakeRepo(seed: StoredCallBackground[] = []) {
	const rows = seed.map((row) => ({ ...row }));
	const blobs = new Map<string, Uint8Array>();

	const repo: CallBackgroundsRepository = {
		async listForUser(userId) {
			return rows.filter((row) => row.user_id === userId);
		},
		async listOldestFirstForUser(userId) {
			return rows
				.filter((row) => row.user_id === userId)
				.map((row) => ({ id: row.id, storage_key: row.storage_key }));
		},
		async getForUser(userId, id) {
			return rows.find((row) => row.id === id && row.user_id === userId) ?? null;
		},
		async insert(input: NewCallBackground) {
			blobs.set(input.storageKey, input.bytes);
			const row: StoredCallBackground = {
				id: input.id,
				user_id: input.userId,
				storage_key: input.storageKey,
				content_type: input.contentType,
				size_bytes: input.sizeBytes,
				created_at: `t${rows.length + 1}`
			};
			rows.push(row);
			return row;
		},
		async remove(id, storageKey) {
			blobs.delete(storageKey);
			const index = rows.findIndex((row) => row.id === id);
			if (index >= 0) rows.splice(index, 1);
		},
		async readBytes(storageKey) {
			return blobs.get(storageKey) ?? null;
		}
	};

	return { repo, rows, blobs };
}

describe('create', () => {
	test('rejects a non-image upload', async () => {
		const { repo } = fakeRepo();
		const service = createCallBackgroundsService({ repo });
		await assert.rejects(
			service.create('user-1', { filename: 'a.txt', type: 'text/plain', bytes: new Uint8Array(1) }),
			/image/
		);
	});

	test('rejects an image type outside the allowlist', async () => {
		const { repo, rows } = fakeRepo();
		const service = createCallBackgroundsService({ repo });
		await assert.rejects(
			service.create('user-1', { filename: 'a.svg', type: 'image/svg+xml', bytes: new Uint8Array(1) }),
			/PNG, JPEG, WebP or GIF/
		);
		assert.equal(rows.length, 0);
	});

	test('stores the normalized type', async () => {
		const { repo } = fakeRepo();
		const service = createCallBackgroundsService({ repo });
		const saved = await service.create('user-1', { filename: 'a.jpg', type: 'IMAGE/JPEG; x=1', bytes: new Uint8Array(1) });
		assert.equal(saved.content_type, 'image/jpeg');
	});

	test('rejects an oversized upload', async () => {
		const { repo } = fakeRepo();
		const service = createCallBackgroundsService({ repo });
		await assert.rejects(
			service.create('user-1', { filename: 'a.png', type: 'image/png', bytes: new Uint8Array(6 * 1024 * 1024) }),
			/exceeds/
		);
	});

	test('stores an upload and lists it back for its owner only', async () => {
		const { repo } = fakeRepo();
		const service = createCallBackgroundsService({ repo });

		const saved = await service.create('user-1', { filename: 'beach.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
		assert.equal(saved.content_type, 'image/png');
		assert.deepEqual((await service.list('user-1')).map((row) => row.id), [saved.id]);
		assert.deepEqual(await service.list('user-2'), []);
		assert.equal(await service.getForUser('user-2', saved.id), null);
	});

	test('drops the oldest upload once the gallery is at capacity', async () => {
		const { repo, rows, blobs } = fakeRepo();
		const service = createCallBackgroundsService({ repo });

		let oldestId = '';
		for (let index = 0; index < 6; index += 1) {
			const saved = await service.create('user-1', { filename: `bg-${index}.png`, type: 'image/png', bytes: new Uint8Array([index]) });
			if (index === 0) oldestId = saved.id;
		}
		assert.equal(rows.length, 6);

		await service.create('user-1', { filename: 'bg-6.png', type: 'image/png', bytes: new Uint8Array([6]) });

		assert.equal(rows.length, 6);
		assert.ok(!rows.some((row) => row.id === oldestId), 'oldest row should have been dropped');
		assert.ok(![...blobs.keys()].some((key) => key.includes(oldestId)), 'oldest bytes should have been deleted');
	});
});

describe('remove', () => {
	test('is scoped to the owner and reports whether it removed anything', async () => {
		const { repo, blobs } = fakeRepo();
		const service = createCallBackgroundsService({ repo });

		const saved = await service.create('user-1', { filename: 'beach.png', type: 'image/png', bytes: new Uint8Array([1]) });
		assert.equal(blobs.size, 1);

		assert.equal(await service.remove('user-2', saved.id), false);
		assert.equal(blobs.size, 1);

		assert.equal(await service.remove('user-1', saved.id), true);
		assert.equal(blobs.size, 0);
		assert.deepEqual(await service.list('user-1'), []);
	});
});
