import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { splitAddressList } from '../address-list';

describe('splitAddressList', () => {
	test('splits on top-level commas only', () => {
		assert.deepEqual(splitAddressList('a@x.com, "Doe, Jane" <j@x.com>, <odd,one@x.com>'), [
			'a@x.com',
			' "Doe, Jane" <j@x.com>',
			' <odd,one@x.com>'
		]);
	});

	test('an escaped quote does not close a quoted name', () => {
		assert.deepEqual(splitAddressList('"Say \\"hi, there\\"" <a@x.com>, b@x.com'), [
			'"Say \\"hi, there\\"" <a@x.com>',
			' b@x.com'
		]);
	});

	test('a doubled backslash leaves the quote unescaped', () => {
		assert.deepEqual(splitAddressList('"a\\\\", b@x.com'), ['"a\\\\"', ' b@x.com']);
	});
});
