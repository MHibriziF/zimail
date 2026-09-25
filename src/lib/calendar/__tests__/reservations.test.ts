import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isPlausibleEmail } from '../events';
import {
	isValidSlug,
	minutesToTime,
	slugify,
	timeToMinutes,
	validateGuest,
	validatePageSettings,
	type ReservationPageSettings
} from '../reservations';
import { computeSlots, isFreeSlot } from '../slots';

const settings = {
	title: 'Office hours',
	slug: '',
	timeZone: 'Asia/Jakarta',
	startDate: '2026-09-28',
	endDate: '2026-10-09',
	weekdays: [1, 2, 3, 4, 5],
	dayStart: 540,
	dayEnd: 720,
	slotMinutes: 60,
	bufferMinutes: 0,
	noticeMinutes: 0
};

const page: ReservationPageSettings = { ...settings, description: null, active: true, withMeeting: false };
const now = new Date('2026-09-24T00:00:00.000Z');

describe('validatePageSettings', () => {
	test('accepts a sensible page and dedupes weekdays', () => {
		const result = validatePageSettings({ ...settings, weekdays: [5, 1, 1] });
		assert.ok(result.ok);
		assert.deepEqual(result.value.weekdays, [1, 5]);
		assert.equal(result.value.active, true);
		assert.equal(result.value.withMeeting, false);
		const withRoom = validatePageSettings({ ...settings, withMeeting: true });
		assert.equal(withRoom.ok && withRoom.value.withMeeting, true);
		const junk = validatePageSettings({ ...settings, withMeeting: 'yes' });
		assert.equal(junk.ok && junk.value.withMeeting, false);
	});

	test('rejects each broken field', () => {
		const cases: [Record<string, unknown>, string][] = [
			[{ title: ' ' }, 'invalid_title'],
			[{ slug: 'Bad Slug' }, 'invalid_slug'],
			[{ timeZone: 'Mars/Olympus' }, 'invalid_time_zone'],
			[{ endDate: '2026-09-01' }, 'invalid_dates'],
			[{ endDate: '2027-09-01' }, 'invalid_dates'],
			[{ slotMinutes: 7 }, 'invalid_hours'],
			[{ dayEnd: 560 }, 'invalid_hours'],
			[{ bufferMinutes: -5 }, 'invalid_hours'],
			[{ weekdays: [9] }, 'invalid_weekdays']
		];
		for (const [patch, error] of cases) {
			assert.deepEqual(validatePageSettings({ ...settings, ...patch }), { ok: false, error }, error);
		}
	});
});

describe('slugs and times', () => {
	test('slugify', () => {
		assert.equal(slugify('  Café — Office Hours!! '), 'cafe-office-hours');
		assert.equal(slugify('a'.repeat(50)), '');
		assert.equal(slugify('one two three four five six seven eight'), 'one-two-three-four-five-six');
	});

	test('isValidSlug', () => {
		assert.ok(isValidSlug('office-hours'));
		assert.ok(!isValidSlug('ab'));
		assert.ok(!isValidSlug('-office'));
		assert.ok(!isValidSlug('office--hours'));
		assert.ok(!isValidSlug('Office'));
	});

	test('minutes and times', () => {
		assert.equal(minutesToTime(570), '09:30');
		assert.equal(timeToMinutes('09:30'), 570);
		assert.equal(timeToMinutes('24:00'), 1440);
		assert.equal(timeToMinutes('25:00'), null);
		assert.equal(timeToMinutes('nope'), null);
	});
});

describe('validateGuest', () => {
	test('accepts a name and email, trims the note', () => {
		assert.deepEqual(validateGuest({ name: ' Ana ', email: 'ana@example.com', note: ' hi ' }), {
			ok: true,
			value: { name: 'Ana', email: 'ana@example.com', note: 'hi' }
		});
	});

	test('refuses header-injection shaped emails', () => {
		assert.deepEqual(validateGuest({ name: 'A', email: 'a@b.com\nBcc: x@y.com' }), { ok: false, error: 'invalid_email' });
		assert.deepEqual(validateGuest({ name: 'A', email: 'a@b.com, c@d.com' }), { ok: false, error: 'invalid_email' });
		assert.deepEqual(validateGuest({ name: '', email: 'a@b.com' }), { ok: false, error: 'invalid_name' });
	});

	test('isPlausibleEmail', () => {
		for (const good of ['a@b.co', 'first.last+tag@sub.example.org']) assert.ok(isPlausibleEmail(good), good);
		for (const bad of ['', 'a', '@b.com', 'a@b', 'a@b.', 'a@.b', 'a@@b.com', 'a@b@c.com', 'a b@c.com', 'a@b.com;c@d.com', '"a"@b.com']) {
			assert.ok(!isPlausibleEmail(bad), bad);
		}
		assert.ok(!isPlausibleEmail(`${'a'.repeat(250)}@b.com`));
	});
});

describe('computeSlots', () => {
	test('hourly slots in the page’s zone on allowed weekdays only', () => {
		// 28 Sept 2026 is a Monday; 3–4 Oct is a weekend.
		const days = computeSlots(page, [], { fromKey: '2026-09-28', days: 7, now });
		assert.deepEqual(
			days.map((day) => [day.date, day.slots.length]),
			[
				['2026-09-28', 3],
				['2026-09-29', 3],
				['2026-09-30', 3],
				['2026-10-01', 3],
				['2026-10-02', 3],
				['2026-10-03', 0],
				['2026-10-04', 0]
			]
		);
		// 09:00 in Jakarta is 02:00Z.
		assert.equal(days[0].slots[0], '2026-09-28T02:00:00.000Z');
	});

	test('clips to the window', () => {
		assert.deepEqual(
			computeSlots(page, [], { fromKey: '2026-09-25', days: 4, now }).map((day) => day.date),
			['2026-09-28']
		);
	});

	test('busy time and the buffer around it remove slots', () => {
		const busy = [{ start: new Date('2026-09-28T03:15:00.000Z'), end: new Date('2026-09-28T03:45:00.000Z') }];
		const [monday] = computeSlots(page, busy, { fromKey: '2026-09-28', days: 1, now });
		assert.deepEqual(monday.slots, ['2026-09-28T02:00:00.000Z', '2026-09-28T04:00:00.000Z']);

		const buffered = computeSlots({ ...page, bufferMinutes: 30 }, busy, { fromKey: '2026-09-28', days: 1, now });
		assert.deepEqual(buffered[0].slots, []);
	});

	test('minimum notice hides slots that start too soon', () => {
		const soon = new Date('2026-09-28T02:30:00.000Z');
		const [monday] = computeSlots({ ...page, noticeMinutes: 60 }, [], { fromKey: '2026-09-28', days: 1, now: soon });
		assert.deepEqual(monday.slots, ['2026-09-28T04:00:00.000Z']);
	});

	test('isFreeSlot only accepts exact free slot starts', () => {
		assert.ok(isFreeSlot(page, [], new Date('2026-09-28T02:00:00.000Z'), now, '2026-09-28'));
		assert.ok(!isFreeSlot(page, [], new Date('2026-09-28T02:30:00.000Z'), now, '2026-09-28'));
		assert.ok(!isFreeSlot(page, [], new Date('2026-10-03T02:00:00.000Z'), now, '2026-10-03'));
	});
});
