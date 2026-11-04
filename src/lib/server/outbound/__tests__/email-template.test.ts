import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { emailLogoAttachment, renderEmailHtml } from '../email-template';

describe('email template logo', () => {
	test('the header points at the inline logo the message carries', () => {
		const logo = emailLogoAttachment();
		assert.equal(logo.disposition, 'inline');
		assert.equal(logo.type, 'image/png');
		assert.ok(renderEmailHtml({ title: 'Hi', lead: 'There' }).includes(`src="cid:${logo.contentId}"`));
	});

	test('the logo is a real PNG', () => {
		const bytes = Buffer.from(emailLogoAttachment().content, 'base64');
		assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		assert.equal(bytes.readUInt32BE(16), 52);
		assert.equal(bytes.readUInt32BE(20), 52);
	});
});
