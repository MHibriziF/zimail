import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { orderByRaisedHand, parseHandRaisedAt } from '../raised-hands';

describe('parseHandRaisedAt', () => {
	test('reads a raise time', () => {
		assert.equal(parseHandRaisedAt('1791066736330'), 1791066736330);
	});

	test('an absent, empty or zero value is a lowered hand', () => {
		assert.equal(parseHandRaisedAt(undefined), null);
		assert.equal(parseHandRaisedAt(''), null);
		assert.equal(parseHandRaisedAt('0'), null);
	});

	test('anything else a client could set is ignored', () => {
		for (const value of ['yes', '-5', '1.5', '1e12', ' 12', '9'.repeat(16)]) {
			assert.equal(parseHandRaisedAt(value), null, value);
		}
	});
});

describe('orderByRaisedHand', () => {
	test('puts raised hands first, earliest raise first, and keeps everyone else in place', () => {
		const people = [
			{ name: 'a', handRaisedAt: null },
			{ name: 'b', handRaisedAt: 300 },
			{ name: 'c', handRaisedAt: null },
			{ name: 'd', handRaisedAt: 100 }
		];
		assert.deepEqual(
			orderByRaisedHand(people).map((person) => person.name),
			['d', 'b', 'a', 'c']
		);
	});

	test('leaves the input untouched', () => {
		const people = [
			{ name: 'a', handRaisedAt: 2 },
			{ name: 'b', handRaisedAt: 1 }
		];
		orderByRaisedHand(people);
		assert.deepEqual(
			people.map((person) => person.name),
			['a', 'b']
		);
	});
});
