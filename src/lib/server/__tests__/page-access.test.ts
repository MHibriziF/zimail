import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { User } from '$lib/types';
import { isPublicPath, pageRedirect, type PageVisit } from '../page-access';

const member: User = {
	id: 'u1',
	email: 'me@example.com',
	name: 'Me',
	is_admin: false,
	must_change_password: false,
	created_at: '2026-01-01'
};
const admin: User = { ...member, is_admin: true };
const firstLogin: User = { ...member, must_change_password: true };

function visit(pathname: string, overrides: Partial<PageVisit> = {}): string | null {
	return pageRedirect({ pathname, user: member, needsSetup: false, needsOnboarding: false, ...overrides });
}

describe('pageRedirect', () => {
	test('a fresh install sends everything but setup and the installer to /setup', () => {
		assert.equal(visit('/inbox', { user: null, needsSetup: true }), '/setup');
		assert.equal(visit('/login', { user: null, needsSetup: true }), '/setup');
		assert.equal(visit('/setup', { user: null, needsSetup: true }), null);
		assert.equal(visit('/install.sh', { user: null, needsSetup: true }), null);
	});

	test('/setup is closed once an account exists', () => {
		assert.equal(visit('/setup'), '/inbox');
		assert.equal(visit('/setup', { user: null }), '/login');
	});

	test('/login sends a signed-in user on', () => {
		assert.equal(visit('/login', { user: null }), null);
		assert.equal(visit('/login'), '/inbox');
		assert.equal(visit('/login', { user: firstLogin }), '/account/setup');
	});

	test('public pages are served to anyone', () => {
		for (const path of ['/meet/abc', '/book/me', '/forgot', '/reset/token', '/account/recovery']) {
			assert.equal(visit(path, { user: null }), null, path);
		}
	});

	test('a private page without a user goes to /login', () => {
		assert.equal(visit('/inbox', { user: null }), '/login');
		assert.equal(visit('/account/setup', { user: null }), '/login');
	});

	test('first login is held on /account/setup', () => {
		assert.equal(visit('/inbox', { user: firstLogin }), '/account/setup');
		assert.equal(visit('/account/setup', { user: firstLogin }), null);
		assert.equal(visit('/onboarding', { user: firstLogin, needsOnboarding: true }), '/account/setup');
		assert.equal(visit('/account/setup'), '/inbox');
	});

	test('onboarding comes before everything else, and only once', () => {
		assert.equal(visit('/inbox', { needsOnboarding: true }), '/onboarding');
		assert.equal(visit('/admin', { user: admin, needsOnboarding: true }), '/onboarding');
		assert.equal(visit('/onboarding', { needsOnboarding: true }), null);
		assert.equal(visit('/onboarding'), '/inbox');
	});

	test('/admin is for admins', () => {
		assert.equal(visit('/admin/users'), '/inbox');
		assert.equal(visit('/admin/users', { user: admin }), null);
		assert.equal(visit('/inbox'), null);
	});
});

describe('isPublicPath', () => {
	test('matches a prefix only on a path boundary', () => {
		assert.ok(isPublicPath('/meet'));
		assert.ok(isPublicPath('/meet/abc'));
		assert.ok(!isPublicPath('/meeting'));
		assert.ok(isPublicPath('/api/meetings/join/x'));
		assert.ok(!isPublicPath('/api/meetings'));
	});
});
