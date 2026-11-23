import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { menuStep, placeMenu, rowActions } from '../row-actions';

const thread = { is_starred: false, is_read: true, is_draft: false };

describe('rowActions', () => {
	it('offers star, label, archive, unread and bin in the inbox', () => {
		assert.deepEqual(rowActions('inbox', thread), ['star', 'label', 'archive', 'unread', 'trash']);
	});

	it('flips to the opposite of the conversation’s state', () => {
		assert.deepEqual(rowActions('inbox', { ...thread, is_starred: true, is_read: false }), [
			'unstar',
			'label',
			'archive',
			'read',
			'trash'
		]);
	});

	it('moves archived mail back to the inbox', () => {
		assert.deepEqual(rowActions('archive', thread), ['star', 'label', 'unarchive', 'unread', 'trash']);
	});

	it('restores or deletes for good from the bin', () => {
		assert.deepEqual(rowActions('trash', thread), ['star', 'label', 'archive', 'unread', 'restore', 'delete']);
	});

	it('has no read state to change for sent mail or drafts', () => {
		assert.deepEqual(rowActions('sent', thread), ['star', 'label', 'archive', 'trash']);
		assert.deepEqual(rowActions('drafts', { ...thread, is_draft: true }), ['star', 'label', 'archive', 'trash']);
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
