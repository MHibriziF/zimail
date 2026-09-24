import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { expandCalendar } from '../index';
import { parseIcs, unescapeText } from '../parse';
import { parseRrule, expandRule } from '../rrule';
import { parseDuration, parseTimeValue, resolveTzid } from '../time';

const CRLF = '\r\n';
function calendar(...events: string[][]): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
		'X-WR-TIMEZONE:Asia/Jakarta',
		...events.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']),
		'END:VCALENDAR'
	].join(CRLF);
}

const window = {
	from: new Date('2026-09-01T00:00:00.000Z'),
	to: new Date('2026-11-01T00:00:00.000Z'),
	fallbackTimeZone: 'UTC'
};

const starts = (text: string, overrides = {}) => expandCalendar(text, { ...window, ...overrides }).map((event) => event.start);

describe('ICS parsing', () => {
	test('unfolds continuation lines, unescapes text and skips alarms', () => {
		const parsed = parseIcs(
			[
				'BEGIN:VCALENDAR',
				'BEGIN:VEVENT',
				'SUMMARY:Planning\\, part',
				' two',
				'BEGIN:VALARM',
				'SUMMARY:Alarm text',
				'END:VALARM',
				'END:VEVENT',
				'END:VCALENDAR'
			].join(CRLF)
		);
		assert.equal(parsed.events.length, 1);
		assert.equal(unescapeText(parsed.events[0].get('SUMMARY')![0].value), 'Planning, parttwo');
	});

	test('a quoted parameter may contain a colon', () => {
		const parsed = parseIcs(
			calendar(['DTSTART;TZID="America/New_York":20260924T090000', 'ORGANIZER;CN="A: B":mailto:a@example.com'])
		);
		assert.equal(parsed.events[0].get('ORGANIZER')![0].value, 'mailto:a@example.com');
		assert.equal(parsed.events[0].get('DTSTART')![0].params.TZID, 'America/New_York');
	});

	test('a quoted parameter may contain a semicolon', () => {
		const parsed = parseIcs(calendar(['ATTENDEE;CN="Doe; Jane";ROLE=REQ-PARTICIPANT:mailto:j@example.com']));
		const attendee = parsed.events[0].get('ATTENDEE')![0];
		assert.deepEqual(attendee.params, { CN: 'Doe; Jane', ROLE: 'REQ-PARTICIPANT' });
		assert.equal(attendee.value, 'mailto:j@example.com');
	});

	test('time values and durations', () => {
		assert.deepEqual(parseTimeValue('20260924', 'UTC'), { naive: Date.UTC(2026, 8, 24), allDay: true, timeZone: 'UTC' });
		assert.equal(parseTimeValue('20260924T0900', 'X')?.naive, Date.UTC(2026, 8, 24, 9));
		assert.equal(parseTimeValue('20260924T090000Z', 'Asia/Jakarta')?.timeZone, 'UTC');
		assert.equal(parseTimeValue('2026-09-24', 'UTC'), null);
		assert.equal(parseDuration('PT1H30M'), 5_400_000);
		assert.equal(parseDuration('P1W'), 7 * 86_400_000);
		assert.equal(parseDuration('-P1D'), -86_400_000);
		assert.equal(parseDuration('P1M'), null);
		assert.equal(parseDuration('PT'), null);
	});

	test('Windows and Mozilla-style zone names resolve to IANA', () => {
		assert.equal(resolveTzid('Pacific Standard Time'), 'America/Los_Angeles');
		assert.equal(resolveTzid('/mozilla.org/20050126_1/Europe/Berlin'), 'Europe/Berlin');
		assert.equal(resolveTzid('Not/AZone'), null);
	});
});

describe('RRULE expansion', () => {
	const expand = (rule: string, start: number, extra: Partial<Parameters<typeof expandRule>[1]> = {}) =>
		expandRule(parseRrule(rule)!, {
			start,
			until: null,
			horizon: Date.UTC(2027, 0, 1),
			notBefore: start,
			limit: 100,
			...extra
		}).map((naive) => new Date(naive).toISOString().slice(0, 10));

	test('weekly on several days with a count', () => {
		// Tuesday 1 Sept 2026.
		assert.deepEqual(expand('FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4', Date.UTC(2026, 8, 1, 9)), [
			'2026-09-01',
			'2026-09-03',
			'2026-09-08',
			'2026-09-10'
		]);
	});

	test('every other week', () => {
		assert.deepEqual(expand('FREQ=WEEKLY;INTERVAL=2;COUNT=3', Date.UTC(2026, 8, 1)), [
			'2026-09-01',
			'2026-09-15',
			'2026-09-29'
		]);
	});

	test('monthly on the last Friday, and on the 31st (skipping short months)', () => {
		assert.deepEqual(expand('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', Date.UTC(2026, 8, 25)), [
			'2026-09-25',
			'2026-10-30',
			'2026-11-27'
		]);
		assert.deepEqual(expand('FREQ=MONTHLY;COUNT=3', Date.UTC(2026, 7, 31)), ['2026-08-31', '2026-10-31', '2026-12-31']);
	});

	test('last weekday of the month via BYSETPOS', () => {
		assert.deepEqual(expand('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=2', Date.UTC(2026, 8, 30)), [
			'2026-09-30',
			'2026-10-30'
		]);
	});

	test('yearly birthday and UNTIL', () => {
		assert.deepEqual(expand('FREQ=YEARLY', Date.UTC(2024, 8, 24), { notBefore: Date.UTC(2026, 0, 1) }), ['2026-09-24']);
		assert.deepEqual(
			expand('FREQ=DAILY', Date.UTC(2026, 8, 1), { until: Date.UTC(2026, 8, 3, 23, 59) }),
			['2026-09-01', '2026-09-02', '2026-09-03']
		);
	});

	test('COUNT counts occurrences before the window too', () => {
		assert.deepEqual(expand('FREQ=DAILY;COUNT=5', Date.UTC(2026, 8, 1), { notBefore: Date.UTC(2026, 8, 4) }), [
			'2026-09-04',
			'2026-09-05'
		]);
	});

	test('an unbounded rule stops at the horizon, and a rule that never matches terminates', () => {
		assert.equal(expand('FREQ=DAILY', Date.UTC(2026, 8, 1)).length, 100);
		assert.deepEqual(expand('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', Date.UTC(2026, 0, 1)), ['2026-01-01']);
	});
});

describe('expandCalendar', () => {
	test('a zoned event becomes a UTC instant', () => {
		const [event] = expandCalendar(
			calendar(['UID:a', 'SUMMARY:Lunch', 'DTSTART;TZID=Asia/Jakarta:20260924T120000', 'DTEND;TZID=Asia/Jakarta:20260924T130000']),
			window
		);
		assert.equal(event.start, '2026-09-24T05:00:00.000Z');
		assert.equal(event.end, '2026-09-24T06:00:00.000Z');
		assert.equal(event.title, 'Lunch');
		assert.equal(event.busy, true);
	});

	test('floating times use the calendar’s own zone', () => {
		assert.deepEqual(starts(calendar(['UID:a', 'DTSTART:20260924T120000', 'DURATION:PT1H'])), ['2026-09-24T05:00:00.000Z']);
	});

	test('all-day events stay floating dates, defaulting to one day', () => {
		const [event] = expandCalendar(calendar(['UID:a', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20260924']), window);
		assert.equal(event.start, '2026-09-24T00:00:00.000Z');
		assert.equal(event.end, '2026-09-25T00:00:00.000Z');
		assert.equal(event.allDay, true);
	});

	test('a weekly series keeps its wall time across DST', () => {
		const events = expandCalendar(
			calendar([
				'UID:w',
				'DTSTART;TZID=America/New_York:20261026T090000',
				'DTEND;TZID=America/New_York:20261026T093000',
				'RRULE:FREQ=WEEKLY;COUNT=2'
			]),
			{ ...window, to: new Date('2026-12-01T00:00:00.000Z') }
		);
		// 9am EDT is 13:00Z; after 1 Nov it's 9am EST, 14:00Z.
		assert.deepEqual(
			events.map((event) => event.start),
			['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z']
		);
	});

	test('EXDATE removes an occurrence and a RECURRENCE-ID moves one', () => {
		const text = calendar(
			[
				'UID:s',
				'SUMMARY:Standup',
				'DTSTART:20260901T020000Z',
				'DTEND:20260901T021500Z',
				'RRULE:FREQ=DAILY;COUNT=4',
				'EXDATE:20260902T020000Z'
			],
			['UID:s', 'SUMMARY:Standup (moved)', 'RECURRENCE-ID:20260903T020000Z', 'DTSTART:20260903T050000Z', 'DTEND:20260903T051500Z']
		);
		const events = expandCalendar(text, window);
		assert.deepEqual(
			events.map((event) => [event.start, event.title]),
			[
				['2026-09-01T02:00:00.000Z', 'Standup'],
				['2026-09-03T05:00:00.000Z', 'Standup (moved)'],
				['2026-09-04T02:00:00.000Z', 'Standup']
			]
		);
		assert.equal(new Set(events.map((event) => event.uid)).size, 3);
	});

	test('a cancelled instance disappears, a cancelled series is dropped', () => {
		const text = calendar(
			['UID:s', 'DTSTART:20260901T020000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'DURATION:PT15M'],
			['UID:s', 'RECURRENCE-ID:20260902T020000Z', 'DTSTART:20260902T020000Z', 'STATUS:CANCELLED'],
			['UID:gone', 'DTSTART:20260905T020000Z', 'STATUS:CANCELLED']
		);
		assert.deepEqual(starts(text), ['2026-09-01T02:00:00.000Z']);
	});

	test('transparent events are free, and events outside the window are dropped', () => {
		const text = calendar(
			['UID:f', 'DTSTART:20260910T020000Z', 'DURATION:PT1H', 'TRANSP:TRANSPARENT'],
			['UID:old', 'DTSTART:20250910T020000Z', 'DURATION:PT1H']
		);
		const events = expandCalendar(text, window);
		assert.equal(events.length, 1);
		assert.equal(events[0].busy, false);
		assert.equal(events[0].title, 'Busy');
	});

	test('a long-running daily series only yields the window, capped by the limit', () => {
		const text = calendar(['UID:d', 'DTSTART:20200101T020000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY']);
		const events = expandCalendar(text, window);
		assert.equal(events[0].start, '2026-08-31T02:00:00.000Z');
		assert.equal(expandCalendar(text, { ...window, limit: 5 }).length, 5);
	});
});
