import { MAX_CALL_BACKGROUND_BYTES, MAX_CALL_BACKGROUNDS_PER_USER } from '../../constants';
import type { CallBackgroundMeta, CallBackgroundsRepository, StoredCallBackground } from './repository';
import { baseContentType } from '$lib/utils/attachments';

const BACKGROUND_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type CallBackgroundsService = {
	list(userId: string): Promise<CallBackgroundMeta[]>;
	getForUser(userId: string, id: string): Promise<StoredCallBackground | null>;
	create(userId: string, input: { filename: string; type: string; bytes: Uint8Array }): Promise<CallBackgroundMeta>;
	readBytes(background: StoredCallBackground): Promise<Uint8Array | null>;
	remove(userId: string, id: string): Promise<boolean>;
};

function buildStorageKey(userId: string, backgroundId: string, filename: string): string {
	const safeName = filename.replace(/[^\w.\-()+ ]+/g, '_').slice(0, 120) || 'background';
	return `call-backgrounds/${userId}/${backgroundId}/${safeName}`;
}

export function createCallBackgroundsService(deps: { repo: CallBackgroundsRepository }): CallBackgroundsService {
	const { repo } = deps;

	async function trimOldestIfAtCap(userId: string): Promise<void> {
		const existing = await repo.listOldestFirstForUser(userId);
		if (existing.length < MAX_CALL_BACKGROUNDS_PER_USER) return;

		const oldest = existing[0];
		await repo.remove(oldest.id, oldest.storage_key);
	}

	return {
		list: (userId) => repo.listForUser(userId),
		getForUser: (userId, id) => repo.getForUser(userId, id),
		readBytes: (background) => repo.readBytes(background.storage_key),

		async create(userId, input) {
			const contentType = baseContentType(input.type);
			if (!BACKGROUND_TYPES.has(contentType)) {
				throw new Error('Backgrounds must be a PNG, JPEG, WebP or GIF image');
			}
			if (input.bytes.byteLength > MAX_CALL_BACKGROUND_BYTES) {
				const limitMb = MAX_CALL_BACKGROUND_BYTES / (1024 * 1024);
				throw new Error(`Image exceeds ${limitMb}MB limit`);
			}

			await trimOldestIfAtCap(userId);

			const id = crypto.randomUUID();
			return repo.insert({
				id,
				userId,
				storageKey: buildStorageKey(userId, id, input.filename),
				contentType,
				sizeBytes: input.bytes.byteLength,
				bytes: input.bytes,
				filename: input.filename
			});
		},

		async remove(userId, id) {
			const row = await repo.getForUser(userId, id);
			if (!row) return false;
			await repo.remove(id, row.storage_key);
			return true;
		}
	};
}
