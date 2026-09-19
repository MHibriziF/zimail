import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyMail } from '../classify';

const mail = (from: string, headers: Record<string, string> = {}, subject = 'Hello') => ({ from, subject, headers });

describe('classifyMail', () => {
	test('a person writing directly is Primary', () => {
		assert.equal(classifyMail(mail('ada@example.com')), 'primary');
	});

	test('mailing-list headers make it Forums', () => {
		assert.equal(classifyMail(mail('someone@example.com', { 'list-id': '<dev.lists.example.org>' })), 'forums');
		assert.equal(classifyMail(mail('someone@example.com', { 'list-post': '<mailto:dev@lists.example.org>' })), 'forums');
	});

	test('hosted discussion lists are Forums without List-Id', () => {
		assert.equal(classifyMail(mail('topic@googlegroups.com')), 'forums');
	});

	test('social network notifications are Social, subdomains included', () => {
		assert.equal(classifyMail(mail('notification@facebookmail.com')), 'social');
		assert.equal(classifyMail(mail('messages-noreply@mail.linkedin.com')), 'social');
	});

	test('a look-alike domain is not treated as social', () => {
		assert.equal(classifyMail(mail('ceo@notlinkedin.com')), 'primary');
	});

	test('a newsletter with an unsubscribe link is Promotions', () => {
		assert.equal(classifyMail(mail('newsletter@shop.test', { 'list-unsubscribe': '<https://shop.test/u>' })), 'promotions');
	});

	test('marketing-platform headers are Promotions', () => {
		assert.equal(classifyMail(mail('team@brand.test', { 'x-mailchimp-campaign': 'abc' })), 'promotions');
	});

	test('bulk mail about an order is Updates, not Promotions', () => {
		assert.equal(
			classifyMail(mail('team@shop.test', { 'list-unsubscribe': '<https://shop.test/u>' }, 'Your order has shipped')),
			'updates'
		);
	});

	test('no-reply and notification senders are Updates', () => {
		assert.equal(classifyMail(mail('no-reply@bank.test')), 'updates');
		assert.equal(classifyMail(mail('notifications@github.test')), 'updates');
	});

	test('Auto-Submitted marks automated mail as Updates, but "no" does not', () => {
		assert.equal(classifyMail(mail('robot@ci.test', { 'auto-submitted': 'auto-generated' })), 'updates');
		assert.equal(classifyMail(mail('ada@example.com', { 'auto-submitted': 'no' })), 'primary');
	});

	test('a precedence of bulk with no other signal is still a mailing', () => {
		assert.equal(classifyMail(mail('team@brand.test', { precedence: 'bulk' })), 'promotions');
	});

	test('an address without @ is read whole, not clipped', () => {
		assert.equal(classifyMail(mail('noreply')), 'updates');
		assert.equal(classifyMail(mail('ada')), 'primary');
	});

	test('a keyword followed by a separator still counts', () => {
		assert.equal(classifyMail(mail('no-reply.eu@bank.test')), 'updates');
	});

	test('a person whose address merely contains a keyword stays Primary', () => {
		assert.equal(classifyMail(mail('newsom@example.com')), 'primary');
		assert.equal(classifyMail(mail('salesforce-fan@example.com')), 'primary');
	});
});
