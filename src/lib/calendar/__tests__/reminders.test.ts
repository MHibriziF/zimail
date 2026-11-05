import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { firstReminderAt, nextReminderAt, parseReminderSetting, reminderKind } from '../reminders';
import { googleCalendarLink, outlookCalendarLink } from '../add-to-calendar';

const start = new Date('2026-11-10T02:00:00.000Z');
const daysBefore = (days: number) => new Date(start.getTime() - days * 86_400_000);

describe('nextReminderAt', () => {
	test('a day ahead, an hour ahead, or both in order', () => {
		const now = daysBefore(3);
		assert.equal(nextReminderAt(start, 'day', now)?.toISOString(), '2026-11-09T02:00:00.000Z');
		assert.equal(nextReminderAt(start, 'hour', now)?.toISOString(), '2026-11-10T01:00:00.000Z');
		assert.equal(nextReminderAt(start, 'both', now)?.toISOString(), '2026-11-09T02:00:00.000Z');
		assert.equal(nextReminderAt(start, 'none', now), null);
	});

	test('after the day-before one, "both" moves on to the hour-before one', () => {
		const sent = new Date('2026-11-09T02:00:00.000Z');
		assert.equal(nextReminderAt(start, 'both', sent)?.toISOString(), '2026-11-10T01:00:00.000Z');
		assert.equal(nextReminderAt(start, 'day', sent), null);
	});

	test('a reminder already in the past is skipped', () => {
		const tenHoursBefore = new Date(start.getTime() - 10 * 3_600_000);
		assert.equal(nextReminderAt(start, 'day', tenHoursBefore), null);
		assert.equal(nextReminderAt(start, 'both', tenHoursBefore)?.toISOString(), '2026-11-10T01:00:00.000Z');
	});
});

describe('firstReminderAt', () => {
	const hoursBefore = (hours: number) => new Date(start.getTime() - hours * 3_600_000);

	test('a day-before reminder only for bookings made two or more days ahead', () => {
		assert.equal(firstReminderAt(start, 'day', hoursBefore(48))?.toISOString(), '2026-11-09T02:00:00.000Z');
		assert.equal(firstReminderAt(start, 'day', hoursBefore(47.9)), null);
		assert.equal(firstReminderAt(start, 'day', hoursBefore(25)), null, 'booked the day before: the confirmation is the reminder');
	});

	test('with both, a booking made a day ahead still gets the hour-before one', () => {
		assert.equal(firstReminderAt(start, 'both', hoursBefore(30))?.toISOString(), '2026-11-10T01:00:00.000Z');
		assert.equal(firstReminderAt(start, 'both', hoursBefore(72))?.toISOString(), '2026-11-09T02:00:00.000Z');
	});

	test('an hour-before reminder only for bookings made two or more hours ahead', () => {
		assert.equal(firstReminderAt(start, 'hour', hoursBefore(2))?.toISOString(), '2026-11-10T01:00:00.000Z');
		assert.equal(firstReminderAt(start, 'hour', hoursBefore(1.5)), null);
		assert.equal(firstReminderAt(start, 'none', hoursBefore(200)), null);
	});
});

test('a due time reads back as the reminder it stands for', () => {
	assert.equal(reminderKind(start, new Date('2026-11-09T02:00:00.000Z')), 'day');
	assert.equal(reminderKind(start, new Date('2026-11-10T01:00:00.000Z')), 'hour');
	// A late cron still recognises the day-before reminder.
	assert.equal(reminderKind(start, new Date('2026-11-09T05:00:00.000Z')), 'day');
});

test('only the known settings parse', () => {
	assert.equal(parseReminderSetting('both'), 'both');
	assert.equal(parseReminderSetting('weekly'), undefined);
	assert.equal(parseReminderSetting(undefined), undefined);
});

describe('add-to-calendar links', () => {
	const event = { title: 'Office hours', start, end: new Date('2026-11-10T02:30:00.000Z'), description: 'Join: https://x.test/meet/a', location: 'Room 3' };

	test('Google gets UTC times without separators', () => {
		const url = new URL(googleCalendarLink(event));
		assert.equal(url.hostname, 'calendar.google.com');
		assert.equal(url.searchParams.get('dates'), '20261110T020000Z/20261110T023000Z');
		assert.equal(url.searchParams.get('text'), 'Office hours');
		assert.equal(url.searchParams.get('location'), 'Room 3');
	});

	test('Outlook gets ISO times', () => {
		const url = new URL(outlookCalendarLink(event));
		assert.equal(url.hostname, 'outlook.office.com');
		assert.equal(url.searchParams.get('startdt'), '2026-11-10T02:00:00.000Z');
		assert.equal(url.searchParams.get('subject'), 'Office hours');
		assert.equal(url.searchParams.get('body'), 'Join: https://x.test/meet/a');
	});
});
