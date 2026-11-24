import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { menuStep, placeAtPoint, placeMenu, rowMenu, selectionMenu } from '../row-actions';

const thread = { is_starred: false, is_read: true, is_draft: false };

describe('rowMenu', () => {
	it('opens, replies, organises, finds the sender and bins in the inbox', () => {
		assert.deepEqual(rowMenu('inbox', thread, true), [
			['open', 'openTab'],
			['reply', 'replyAll', 'forward'],
			['star', 'label', 'unread', 'archive'],
			['copySender', 'withSender'],
			['spam', 'trash']
		]);
	});

	it('flips to the opposite of the conversation state', () => {
		const sections = rowMenu('inbox', { ...thread, is_starred: true, is_read: false }, true);
		assert.deepEqual(sections[2], ['unstar', 'label', 'read', 'archive']);
	});

	it('moves archived mail back to the inbox', () => {
		assert.deepEqual(rowMenu('archive', thread, true)[2], ['star', 'label', 'unread', 'unarchive']);
	});

	it('restores or deletes for good from the bin, with no spam report', () => {
		assert.deepEqual(rowMenu('trash', thread, true).at(-1), ['restore', 'delete']);
	});

	it('undoes a spam verdict from Spam', () => {
		assert.deepEqual(rowMenu('spam', thread, true).at(-1), ['notspam', 'trash']);
	});

	it('has no read state, spam report or sender for your own sent mail', () => {
		assert.deepEqual(rowMenu('sent', thread, false), [
			['open', 'openTab'],
			['reply', 'replyAll', 'forward'],
			['star', 'label', 'archive'],
			['trash']
		]);
	});

	it('edits a draft rather than opening or answering it', () => {
		assert.deepEqual(rowMenu('drafts', { ...thread, is_draft: true }, true), [
			['editDraft'],
			['star', 'label', 'archive'],
			['trash']
		]);
	});
});

describe('selectionMenu', () => {
	it('stars and marks read while any of the selection needs it', () => {
		assert.deepEqual(selectionMenu('inbox', [thread, { ...thread, is_starred: true, is_read: false }]), [
			['star', 'read', 'archive'],
			['spam', 'trash']
		]);
	});

	it('unstars and marks unread once all of it is starred and read', () => {
		const all = { ...thread, is_starred: true };
		assert.deepEqual(selectionMenu('inbox', [all, all])[0], ['unstar', 'unread', 'archive']);
	});

	it('only restores from the bin', () => {
		assert.deepEqual(selectionMenu('trash', [thread, thread]).at(-1), ['restore']);
	});

	it('leaves out spam when a draft is selected', () => {
		assert.deepEqual(selectionMenu('inbox', [thread, { ...thread, is_draft: true }]).at(-1), ['trash']);
	});
});

describe('menuStep', () => {
	it('moves down and up, wrapping at the ends', () => {
		assert.equal(menuStep('ArrowDown', 0, 3), 1);
		assert.equal(menuStep('ArrowDown', 2, 3), 0);
		assert.equal(menuStep('ArrowUp', 0, 3), 2);
		assert.equal(menuStep('ArrowUp', 2, 3), 1);
	});

	it('jumps to the ends', () => {
		assert.equal(menuStep('Home', 2, 4), 0);
		assert.equal(menuStep('End', 0, 4), 3);
	});

	it('starts from the first item when nothing in the menu has focus', () => {
		assert.equal(menuStep('ArrowDown', -1, 3), 0);
	});

	it('ignores other keys and empty menus', () => {
		assert.equal(menuStep('a', 0, 3), null);
		assert.equal(menuStep('ArrowDown', 0, 0), null);
	});
});

describe('placeMenu', () => {
	const viewport = { width: 390, height: 844 };
	const menu = { width: 200, height: 180 };

	it('opens under the button, its right edge lined up with the button’s', () => {
		assert.deepEqual(placeMenu({ top: 100, bottom: 144, right: 380 }, menu, viewport), { left: 180, top: 148 });
	});

	it('opens above when there is no room below', () => {
		assert.deepEqual(placeMenu({ top: 760, bottom: 804, right: 380 }, menu, viewport), { left: 180, top: 576 });
	});

	it('stays on screen at the left edge and the top', () => {
		const placed = placeMenu({ top: 4, bottom: 40, right: 50 }, { width: 200, height: 900 }, viewport);
		assert.deepEqual(placed, { left: 8, top: 8 });
	});
});

describe('placeAtPoint', () => {
	const menu = { width: 200, height: 300 };
	const viewport = { width: 1000, height: 800 };

	it('opens right and down from the pointer', () => {
		assert.deepEqual(placeAtPoint({ x: 100, y: 100 }, menu, viewport), { left: 100, top: 100 });
	});

	it('flips left and up near the far edges', () => {
		assert.deepEqual(placeAtPoint({ x: 900, y: 700 }, menu, viewport), { left: 700, top: 400 });
	});

	it('stays on screen when it fits neither way', () => {
		assert.deepEqual(placeAtPoint({ x: 50, y: 50 }, { width: 200, height: 900 }, viewport), { left: 50, top: 8 });
	});
});
