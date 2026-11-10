import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DeliveryStatus } from '$lib/types';
import { canMoveDeliveryStatus, deliveryStatusesBefore } from '../delivery-status';

const ALL: DeliveryStatus[] = ['queued', 'sent', 'delayed', 'delivered', 'bounced', 'complained', 'failed'];
const TERMINAL: DeliveryStatus[] = ['bounced', 'complained', 'failed'];

const LEGAL = new Set([
	'queued>sent',
	'queued>delayed',
	'queued>delivered',
	'sent>delayed',
	'sent>delivered',
	'delayed>delivered',
	...['queued', 'sent', 'delayed', 'delivered'].flatMap((from) => TERMINAL.map((to) => `${from}>${to}`))
]);

describe('canMoveDeliveryStatus', () => {
	for (const from of ALL) {
		for (const to of ALL) {
			const legal = LEGAL.has(`${from}>${to}`);
			test(`${from} → ${to} is ${legal ? 'allowed' : 'refused'}`, () => {
				assert.equal(canMoveDeliveryStatus(from, to), legal);
			});
		}
	}
});

describe('deliveryStatusesBefore', () => {
	test('lists exactly the states each status may replace', () => {
		for (const to of ALL) {
			assert.deepEqual(
				deliveryStatusesBefore(to),
				ALL.filter((from) => LEGAL.has(`${from}>${to}`))
			);
		}
	});

	test('a late sent can only replace queued', () => {
		assert.deepEqual(deliveryStatusesBefore('sent'), ['queued']);
	});

	test('a failure never replaces another failure', () => {
		for (const to of TERMINAL) {
			assert.ok(TERMINAL.every((from) => !deliveryStatusesBefore(to).includes(from)));
		}
	});
});
