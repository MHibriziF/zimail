import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceErrorKey } from '../device-errors';

const named = (name: string) => Object.assign(new Error('x'), { name });

test('each browser reason gets the message with its own fix', () => {
	assert.equal(deviceErrorKey(named('NotAllowedError')), 'meet.deviceErrorBlocked');
	assert.equal(deviceErrorKey(named('NotReadableError')), 'meet.deviceErrorBusy');
	assert.equal(deviceErrorKey(named('NotFoundError')), 'meet.deviceErrorMissing');
	assert.equal(deviceErrorKey(named('OverconstrainedError')), 'meet.deviceErrorUnavailable');
});

test('anything else, or no error at all, falls back to the general message', () => {
	assert.equal(deviceErrorKey(named('TypeError')), 'meet.deviceError');
	assert.equal(deviceErrorKey('boom'), 'meet.deviceError');
	assert.equal(deviceErrorKey(undefined), 'meet.deviceError');
	assert.equal(deviceErrorKey(named('constructor')), 'meet.deviceError', 'no prototype lookups');
});

test('an insecure page is told why, whatever the browser threw', (t) => {
	t.after(() => delete (globalThis as { isSecureContext?: boolean }).isSecureContext);
	Object.assign(globalThis, { isSecureContext: false });
	assert.equal(deviceErrorKey(named('NotAllowedError')), 'meet.deviceErrorInsecure');
});
