import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import type { EmailProvider } from '../../email-provider';
import type { OutboundMailInput } from '../../outbound/send-mail';
import { calendarServiceFor } from '../index';

type Query = { sql: string; args: unknown[] };

const address = {
	id: 'a1',
	user_id: 'u1',
	domain_id: 'd1',
	domain_name: 'example.test',
	address: 'Me@example.test',
	label: null,
	is_default: 1,
	signature: null
};

function setup(respond: (query: Query) => unknown[] = () => []) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		if (query.sql.includes('FROM addresses')) return [address];
		if (query.sql.includes('SELECT name FROM users')) return [{ name: 'Izi' }];
		if (query.sql.includes('SELECT timezone FROM users')) return [{ timezone: 'Asia/Jakarta' }];
		return respond(query);
	});
	const sent: OutboundMailInput[] = [];
	const provider = {
		kind: 'resend',
		async send(input: OutboundMailInput) {
			if (input.to.includes('bounce@example.com')) throw new Error('rejected');
			sent.push(input);
			return { providerId: `p${sent.length}` };
		}
	} as unknown as EmailProvider;
	return { db, queries, sent, provider: () => provider };
}

const input = {
	title: 'Planning',
	start: '2026-10-01T02:00:00.000Z',
	end: '2026-10-01T03:00:00.000Z',
	allDay: false
};

const decode = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.codePointAt(0)!));

describe('calendarServiceFor', () => {
	test('each guest gets their own invitation from the default address', async () => {
		const { db, sent, provider } = setup();
		const outcome = await calendarServiceFor(db, provider).create('u1', {
			...input,
			guests: ['ada@example.com', 'bo@example.com']
		});
		assert.equal(outcome.type, 'ok');
		assert.deepEqual(
			sent.map((mail) => mail.to),
			[['ada@example.com'], ['bo@example.com']]
		);
		const [first] = sent;
		assert.equal(first.from.address, 'Me@example.test');
		assert.equal(first.senderName, 'Izi');
		assert.equal(first.subject, 'Invitation: Planning');
		assert.equal(first.attachments?.[0].type, 'text/calendar; method=REQUEST; charset=UTF-8');
		const ics = decode(first.attachments?.[0].content ?? '');
		assert.match(ics, new RegExp(`UID:${outcome.type === 'ok' ? outcome.event.id : ''}@zimail`));
		assert.match(ics, /ORGANIZER;CN="Izi":mailto:me@example\.test/);
		assert.match(first.text, /\(Asia\/Jakarta\)/);
	});

	test('one bounced guest does not stop the others or the save', async () => {
		const { db, sent, provider } = setup();
		const quiet = console.error;
		const logged: unknown[] = [];
		console.error = (...args: unknown[]) => logged.push(args);
		try {
			const outcome = await calendarServiceFor(db, provider).create('u1', {
				...input,
				guests: ['bounce@example.com', 'ada@example.com']
			});
			assert.equal(outcome.type, 'ok');
		} finally {
			console.error = quiet;
		}
		assert.equal(sent.length, 1);
		assert.equal(logged.length, 1);
	});

	test('without a provider, the guest list is still stored', async () => {
		const { db, queries } = setup();
		await calendarServiceFor(db).create('u1', { ...input, guests: ['ada@example.com'] });
		assert.ok(queries.some((query) => query.sql.startsWith('INSERT OR IGNORE INTO event_guests')));
		assert.ok(!queries.some((query) => query.sql.includes('FROM addresses')));
	});

	test('a user with no address sends nothing', async () => {
		const queries: Query[] = [];
		const db = createFakeD1((query) => {
			queries.push(query);
			return [];
		});
		let sends = 0;
		const provider = { send: async () => ({ providerId: String(++sends) }) } as unknown as EmailProvider;
		await calendarServiceFor(db, () => provider).create('u1', { ...input, guests: ['ada@example.com'] });
		assert.equal(sends, 0);
	});
});
