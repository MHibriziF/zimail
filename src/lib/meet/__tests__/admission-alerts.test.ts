import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { takeUnseenAdmissions } from '../admission-alerts';

describe('takeUnseenAdmissions', () => {
	test('reports everything on the first poll, including requests already waiting', () => {
		const seen = new Set<string>();
		assert.deepEqual(takeUnseenAdmissions(seen, [{ id: 'a' }, { id: 'b' }]), [{ id: 'a' }, { id: 'b' }]);
	});

	test('does not report the same request twice', () => {
		const seen = new Set<string>();
		takeUnseenAdmissions(seen, [{ id: 'a' }]);
		assert.deepEqual(takeUnseenAdmissions(seen, [{ id: 'a' }]), []);
	});

	test('catches a new request even when another was answered in the same poll', () => {
		const seen = new Set<string>();
		takeUnseenAdmissions(seen, [{ id: 'a' }]);
		assert.deepEqual(takeUnseenAdmissions(seen, [{ id: 'b' }]), [{ id: 'b' }]);
	});

	test('an empty poll reports nothing', () => {
		assert.deepEqual(takeUnseenAdmissions(new Set(), []), []);
	});
});
