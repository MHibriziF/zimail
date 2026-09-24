import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createFakeD1 } from '../../__tests__/support/fake-d1';
import { applyArrivedInvitation, hasBytes, invitationsServiceFor } from '../index';

type Query = { sql: string; args: unknown[] };

const encode = (text: string) => new TextEncoder().encode(text);

const cancel = [
	'BEGIN:VCALENDAR',
	'METHOD:CANCEL',
	'BEGIN:VEVENT',
	'UID:meet-1',
	'SEQUENCE:1',
	'DTSTART:20260925T033000Z',
	'DTEND:20260925T040000Z',
	'END:VEVENT',
	'END:VCALENDAR'
].join('\r\n');

function setup(respond: (query: Query) => unknown[]) {
	const queries: Query[] = [];
	const db = createFakeD1((query) => {
		queries.push(query);
		return respond(query);
	});
	return { db, queries };
}

describe('applyArrivedInvitation', () => {
	test('a cancellation of an answered invitation takes it off the calendar', async () => {
		const { db, queries } = setup((query) => {
			if (query.sql.includes('FROM calendar_invites')) return [{ uid: 'meet-1', sequence: 0, response: 'accepted' }];
			if (query.sql.includes('FROM addresses') || query.sql.includes('FROM users')) return [];
			return [];
		});
		await applyArrivedInvitation(db, 'u1', [
			{ contentType: 'application/pdf', filename: 'agenda.pdf', bytes: encode('%PDF') },
			{ contentType: 'text/calendar; method=CANCEL', filename: 'invite.ics', bytes: encode(cancel) }
		]);
		assert.ok(queries.some((query) => /DELETE FROM calendar_events/.test(query.sql)));
		assert.ok(queries.some((query) => /INSERT INTO calendar_invites/.test(query.sql)));
	});

	test('a guest’s reply to the user’s own invitation is recorded against that guest', async () => {
		const reply = cancel
			.replace('METHOD:CANCEL', 'METHOD:REPLY')
			.replace('UID:meet-1', 'UID:ev-1@zimail')
			.replace('END:VEVENT', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:guest@gmail.test\r\nEND:VEVENT');
		const { db, queries } = setup((query) => {
			if (query.sql.includes('FROM calendar_events')) {
				return [{ id: 'ev-1', title: 'Demo', starts_at: 's', ends_at: 'e', all_day: 0, source: 'reservation', sequence: 0 }];
			}
			if (query.sql.startsWith('UPDATE event_guests')) return [{}];
			return [];
		});
		await applyArrivedInvitation(db, 'u1', [{ contentType: 'text/calendar', filename: 'invite.ics', bytes: encode(reply) }]);
		const update = queries.find((query) => query.sql.startsWith('UPDATE event_guests'));
		assert.deepEqual(update?.args, ['accepted', 'ev-1', 'u1', 'guest@gmail.test']);
		assert.ok(!queries.some((query) => query.sql.includes('calendar_invites')), 'not treated as an invitation to the user');
	});

	test('a message with no calendar part touches nothing', async () => {
		const { db, queries } = setup(() => []);
		await applyArrivedInvitation(db, 'u1', [{ contentType: 'image/png', filename: 'a.png', bytes: encode('x') }]);
		assert.equal(queries.length, 0);
	});

	test('a failure is logged, never thrown — the message is already stored', async () => {
		const db = createFakeD1(() => {
			throw new Error('D1 down');
		});
		await assert.doesNotReject(
			applyArrivedInvitation(db, 'u1', [{ contentType: 'text/calendar', filename: 'invite.ics', bytes: encode(cancel) }])
		);
	});
});

describe('invitationsServiceFor', () => {
	const request = cancel.replace('METHOD:CANCEL', 'METHOD:REQUEST').replace(
		'END:VEVENT',
		['SUMMARY:Demo', 'ORGANIZER;CN=Ada:mailto:ada@example.com', 'ATTENDEE;RSVP=TRUE:mailto:me@zimail.test', 'END:VEVENT'].join('\r\n')
	);

	function wire() {
		const { db, queries } = setup((query) => {
			if (/FROM email_attachments\s+WHERE email_id/.test(query.sql)) {
				return [
					{ id: 'a-pdf', filename: 'agenda.pdf', content_type: 'application/pdf', size_bytes: 10 },
					{ id: 'a-ics', filename: 'invite.ics', content_type: 'application/ics', size_bytes: request.length }
				];
			}
			if (query.sql.includes('FROM email_attachments a')) {
				return [{ id: 'a-ics', email_id: 'e1', filename: 'invite.ics', content_type: 'application/ics', storage_key: 'e1/a-ics/invite.ics' }];
			}
			if (query.sql.includes('FROM addresses a')) {
				return [{ id: 'addr', user_id: 'u1', domain_id: 'd', domain_name: 'zimail.test', address: 'me@zimail.test', label: null, is_default: 1 }];
			}
			if (query.sql.includes('SELECT name FROM users')) return [{ name: 'Me' }];
			if (query.sql.includes('SELECT timezone FROM users')) return [{ timezone: null }];
			return [];
		});
		const bucket = {
			get: async (key: string) => (key === 'e1/a-ics/invite.ics' ? { arrayBuffer: async () => encode(request).buffer } : null)
		};
		const sent: { to: unknown; subject: string; attachments?: { type: string }[] }[] = [];
		const provider = {
			send: async (input: (typeof sent)[number]) => {
				sent.push(input);
				return { providerId: 'p1' };
			}
		};
		// The fakes stand in for just the calls this path makes.
		const service = invitationsServiceFor(db, bucket as never, () => provider as never);
		return { service, queries, sent };
	}

	test('reads the stored .ics part and answers the organizer from the invited address', async () => {
		const { service, sent } = wire();
		const view = await service.inspect('u1', 'e1');
		assert.equal(view?.title, 'Demo');
		assert.equal(view?.canReply, true);

		const outcome = await service.act('u1', 'e1', 'accepted');
		assert.equal(outcome.type === 'ok' && outcome.replied, true);
		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0].to, ['ada@example.com']);
		assert.equal(sent[0].subject, 'Accepted: Demo');
		assert.equal(sent[0].attachments?.[0].type, 'text/calendar; method=REPLY; charset=UTF-8');
	});

	test('without storage there is no invitation to read', async () => {
		assert.equal(await invitationsServiceFor(setup(() => []).db, undefined).inspect('u1', 'e1'), null);
	});
});

describe('hasBytes', () => {
	test('keeps only attachments whose bytes were kept', () => {
		const kept = [{ bytes: encode('x') }, {}].filter(hasBytes);
		assert.equal(kept.length, 1);
	});
});
