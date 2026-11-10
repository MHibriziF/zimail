import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { admissionStatusesBefore, canMoveAdmission, type AdmissionStatus } from '../status';

const ALL: AdmissionStatus[] = ['pending', 'admitted', 'denied', 'joined'];
const LEGAL = new Set(['pending>admitted', 'pending>denied', 'admitted>joined']);

describe('canMoveAdmission', () => {
	for (const from of ALL) {
		for (const to of ALL) {
			const legal = LEGAL.has(`${from}>${to}`);
			test(`${from} → ${to} is ${legal ? 'allowed' : 'refused'}`, () => {
				assert.equal(canMoveAdmission(from, to), legal);
			});
		}
	}
});

describe('admissionStatusesBefore', () => {
	test('a decision only replaces pending, and joining only replaces admitted', () => {
		assert.deepEqual(admissionStatusesBefore('admitted'), ['pending']);
		assert.deepEqual(admissionStatusesBefore('denied'), ['pending']);
		assert.deepEqual(admissionStatusesBefore('joined'), ['admitted']);
		assert.deepEqual(admissionStatusesBefore('pending'), []);
	});
});
