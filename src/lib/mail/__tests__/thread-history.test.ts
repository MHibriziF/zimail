import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeThreadGoesBack, openThreadNavigation } from '../thread-history';

describe('thread history', () => {
	it('adds an entry when a conversation is opened from the list', () => {
		assert.deepEqual(openThreadNavigation(null, {}), { replaceState: false, state: { fromList: true } });
	});

	it('replaces the entry when moving to another conversation, keeping where it came from', () => {
		assert.deepEqual(openThreadNavigation('a', { fromList: true }), { replaceState: true, state: { fromList: true } });
		assert.deepEqual(openThreadNavigation('a', {}), { replaceState: true, state: {} });
	});

	it('closes by going Back only to the list it was opened from', () => {
		assert.equal(closeThreadGoesBack({ fromList: true }), true);
		assert.equal(closeThreadGoesBack({}), false);
	});
});
