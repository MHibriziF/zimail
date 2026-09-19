import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_LABELS_PER_USER, type Label, type LabelColor } from '../../../mail/labels';
import type { LabelsRepository } from '../repository';
import { createLabelsService } from '../service';

/** In-memory repo enforcing the same case-insensitive per-user unique name the migration does. */
function fakeRepo() {
	const labels: (Label & { userId: string })[] = [];
	const links: { userId: string; conversationId: string; labelId: string }[] = [];

	function assertNameFree(userId: string, name: string, exceptId?: string) {
		if (labels.some((l) => l.userId === userId && l.id !== exceptId && l.name.toLowerCase() === name.toLowerCase())) {
			throw new Error('UNIQUE constraint failed: labels.user_id, labels.name');
		}
	}

	const repo: LabelsRepository = {
		async listForUser(userId) {
			return labels.filter((l) => l.userId === userId).map(({ id, name, color }) => ({ id, name, color }));
		},
		async countForUser(userId) {
			return labels.filter((l) => l.userId === userId).length;
		},
		async insert(label) {
			assertNameFree(label.userId, label.name);
			labels.push({ id: label.id, userId: label.userId, name: label.name, color: label.color });
		},
		async update(userId, id, patch) {
			const label = labels.find((l) => l.id === id && l.userId === userId);
			if (!label) return false;
			if (patch.name !== undefined) {
				assertNameFree(userId, patch.name, id);
				label.name = patch.name;
			}
			if (patch.color !== undefined) label.color = patch.color;
			return true;
		},
		async delete(userId, id) {
			const index = labels.findIndex((l) => l.id === id && l.userId === userId);
			if (index < 0) return false;
			labels.splice(index, 1);
			for (let i = links.length - 1; i >= 0; i--) if (links[i].labelId === id) links.splice(i, 1);
			return true;
		},
		async ownedIds(userId, ids) {
			return ids.filter((id) => labels.some((l) => l.id === id && l.userId === userId));
		},
		async setForConversation(userId, conversationId, labelIds) {
			for (let i = links.length - 1; i >= 0; i--) {
				if (links[i].userId === userId && links[i].conversationId === conversationId) links.splice(i, 1);
			}
			for (const labelId of labelIds) links.push({ userId, conversationId, labelId });
		},
		async listForConversations(userId, conversationIds) {
			const result = new Map<string, Label[]>();
			for (const link of links) {
				if (link.userId !== userId || !conversationIds.includes(link.conversationId)) continue;
				const label = labels.find((l) => l.id === link.labelId)!;
				const list = result.get(link.conversationId) ?? [];
				list.push({ id: label.id, name: label.name, color: label.color });
				result.set(link.conversationId, list);
			}
			return result;
		}
	};
	return { repo, labels, links };
}

/** Messages `m1` (a reply in conversation `c1`) and `m2` belong to user-1. */
async function conversationOf(userId: string, emailId: string): Promise<string | null> {
	if (userId !== 'user-1') return null;
	return ({ m1: 'c1', m2: 'm2' } as Record<string, string>)[emailId] ?? null;
}

function setup() {
	const fake = fakeRepo();
	return { ...fake, service: createLabelsService({ repo: fake.repo, conversationOf }) };
}

const blue: LabelColor = 'blue';

describe('creating labels', () => {
	test('a new label is stored with a tidied name', async () => {
		const { service } = setup();
		const outcome = await service.create('user-1', { name: '  Work   items ', color: blue });
		assert.equal(outcome.type, 'ok');
		if (outcome.type === 'ok') assert.equal(outcome.label.name, 'Work items');
	});

	test('an empty name is rejected', async () => {
		const { service } = setup();
		assert.deepEqual(await service.create('user-1', { name: '  ', color: blue }), { type: 'invalid_name' });
	});

	test('a name already used by the same user is a duplicate, ignoring case', async () => {
		const { service } = setup();
		await service.create('user-1', { name: 'Work', color: blue });
		assert.deepEqual(await service.create('user-1', { name: 'work', color: blue }), { type: 'duplicate_name' });
	});

	test('another user can use the same name', async () => {
		const { service } = setup();
		await service.create('user-1', { name: 'Work', color: blue });
		assert.equal((await service.create('user-2', { name: 'Work', color: blue })).type, 'ok');
	});

	test('the per-user limit is enforced', async () => {
		const { service } = setup();
		for (let i = 0; i < MAX_LABELS_PER_USER; i++) await service.create('user-1', { name: `L${i}`, color: blue });
		assert.deepEqual(await service.create('user-1', { name: 'one more', color: blue }), { type: 'limit_reached' });
	});
});

describe('updating and removing labels', () => {
	test('rename and recolor', async () => {
		const { service } = setup();
		const created = await service.create('user-1', { name: 'Work', color: blue });
		assert.equal(created.type, 'ok');
		if (created.type !== 'ok') return;
		const updated = await service.update('user-1', created.label.id, { name: 'Job', color: 'red' });
		assert.deepEqual(updated, { type: 'ok', label: { id: created.label.id, name: 'Job', color: 'red' } });
	});

	test("someone else's label can't be changed or removed", async () => {
		const { service } = setup();
		const created = await service.create('user-1', { name: 'Work', color: blue });
		if (created.type !== 'ok') return;
		assert.deepEqual(await service.update('user-2', created.label.id, { name: 'Mine' }), { type: 'not_found' });
		assert.equal(await service.remove('user-2', created.label.id), false);
		assert.equal((await service.list('user-1')).length, 1);
	});

	test('renaming onto an existing name is a duplicate', async () => {
		const { service } = setup();
		await service.create('user-1', { name: 'Work', color: blue });
		const other = await service.create('user-1', { name: 'Home', color: blue });
		if (other.type !== 'ok') return;
		assert.deepEqual(await service.update('user-1', other.label.id, { name: 'WORK' }), { type: 'duplicate_name' });
	});
});

describe('labelling conversations', () => {
	test('labels attach to the whole conversation of the message', async () => {
		const { service } = setup();
		const work = await service.create('user-1', { name: 'Work', color: blue });
		if (work.type !== 'ok') return;

		const applied = await service.setForMessage('user-1', 'm1', [work.label.id]);
		assert.deepEqual(applied?.map((l) => l.name), ['Work']);
		assert.deepEqual((await service.listForConversations('user-1', ['c1'])).get('c1')?.map((l) => l.id), [work.label.id]);
	});

	test('setting replaces the previous labels', async () => {
		const { service } = setup();
		const work = await service.create('user-1', { name: 'Work', color: blue });
		const home = await service.create('user-1', { name: 'Home', color: blue });
		if (work.type !== 'ok' || home.type !== 'ok') return;

		await service.setForMessage('user-1', 'm2', [work.label.id]);
		const applied = await service.setForMessage('user-1', 'm2', [home.label.id]);
		assert.deepEqual(applied?.map((l) => l.name), ['Home']);
	});

	test("labels the user doesn't own are dropped silently", async () => {
		const { service } = setup();
		const theirs = await service.create('user-2', { name: 'Theirs', color: blue });
		if (theirs.type !== 'ok') return;
		assert.deepEqual(await service.setForMessage('user-1', 'm2', [theirs.label.id]), []);
	});

	test("a message that isn't the user's can't be labelled", async () => {
		const { service, links } = setup();
		const work = await service.create('user-2', { name: 'Work', color: blue });
		if (work.type !== 'ok') return;
		assert.equal(await service.setForMessage('user-2', 'm1', [work.label.id]), null);
		assert.equal(links.length, 0);
	});

	test('deleting a label removes it from conversations', async () => {
		const { service } = setup();
		const work = await service.create('user-1', { name: 'Work', color: blue });
		if (work.type !== 'ok') return;
		await service.setForMessage('user-1', 'm1', [work.label.id]);
		await service.remove('user-1', work.label.id);
		assert.equal((await service.listForConversations('user-1', ['c1'])).get('c1'), undefined);
	});
});
