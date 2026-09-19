import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { authenticationFailed } from '../authentication';

describe('authenticationFailed', () => {
	test('a DMARC failure is spam', () => {
		assert.equal(authenticationFailed('mx.example.com; spf=pass smtp.mailfrom=x.com; dkim=pass; dmarc=fail (p=reject)'), true);
	});

	test('SPF and DKIM both failing is spam', () => {
		assert.equal(authenticationFailed('mx.example.com; spf=fail smtp.mailfrom=x.com; dkim=fail header.d=x.com'), true);
	});

	test('only one of SPF or DKIM failing is not enough — forwarding breaks one routinely', () => {
		assert.equal(authenticationFailed('mx.example.com; spf=fail; dkim=pass; dmarc=pass'), false);
		assert.equal(authenticationFailed('mx.example.com; spf=pass; dkim=fail'), false);
	});

	test('passing mail is not spam', () => {
		assert.equal(authenticationFailed('mx.example.com; spf=pass; dkim=pass; dmarc=pass'), false);
	});

	test('no header at all is not spam', () => {
		assert.equal(authenticationFailed(undefined, null, ''), false);
	});

	test('verdicts can be split across several headers and are case-insensitive', () => {
		assert.equal(authenticationFailed('mx.example.com; SPF=FAIL', 'arc.example.com; DKIM=Fail'), true);
	});

	test('a method name inside another token does not count', () => {
		// "xdmarc=fail" is not a dmarc verdict.
		assert.equal(authenticationFailed('mx.example.com; xdmarc=fail; spf=pass'), false);
	});

	test('one failing DKIM signature beside a passing one is not a failure', () => {
		// Common with mailing lists that add their own signature.
		assert.equal(authenticationFailed('mx.example.com; spf=fail; dkim=fail header.d=list.test; dkim=pass header.d=sender.test'), false);
	});

	test('a DMARC fail from one hop is outweighed by a pass from another', () => {
		assert.equal(authenticationFailed('mx.example.com; dmarc=fail', 'arc.example.com; dmarc=pass'), false);
	});

	test('several results that all fail still count as failed', () => {
		assert.equal(authenticationFailed('mx.example.com; spf=fail; dkim=fail header.d=a.test; dkim=fail header.d=b.test'), true);
	});

	test('softfail and none are not failures', () => {
		assert.equal(authenticationFailed('mx.example.com; spf=softfail; dkim=none; dmarc=none'), false);
	});
});
