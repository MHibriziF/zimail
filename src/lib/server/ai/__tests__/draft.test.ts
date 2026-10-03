import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftForModel, eventDraft, withConflicts, type EventDraft } from '../draft';

function draft(raw: Record<string, unknown>, timeZone = 'UTC'): EventDraft {
	const result = eventDraft(raw, timeZone);
	assert.ok(!('error' in result), JSON.stringify(result));
	return result;
}

test('a timed draft runs 30 minutes unless the end time comes after the start', () => {
	assert.equal(draft({ title: 'Call', date: '2026-10-05', start_time: '9:00' }).end, '2026-10-05T09:30:00.000Z');
	assert.equal(draft({ title: 'Call', date: '2026-10-05', start_time: '09:00', end_time: '10:15' }).end, '2026-10-05T10:15:00.000Z');
	assert.equal(draft({ title: 'Call', date: '2026-10-05', start_time: '09:00', end_time: '08:00' }).end, '2026-10-05T09:30:00.000Z');
});

test('wall times are read in the reader’s zone', () => {
	assert.equal(draft({ title: 'Call', date: '2026-10-05', start_time: '09:00' }, 'Asia/Jakarta').start, '2026-10-05T02:00:00.000Z');
});

test('an all-day draft covers its date, with an exclusive end', () => {
	const birthday = draft({ title: 'Birthday', date: '2026-10-05', all_day: true, start_time: '09:00' });
	assert.deepEqual([birthday.start, birthday.end, birthday.allDay], ['2026-10-05', '2026-10-06', true]);
});

test('what the model got wrong comes back as an error to fix', () => {
	assert.deepEqual(eventDraft({ date: '2026-10-05', start_time: '09:00' }, 'UTC'), { error: 'Give the event a title.' });
	assert.match(String((eventDraft({ title: 'x', date: 'tomorrow' }, 'UTC') as { error: string }).error), /YYYY-MM-DD/);
	assert.match(String((eventDraft({ title: 'x', date: '2026-02-31x' }, 'UTC') as { error: string }).error), /YYYY-MM-DD/);
	assert.match(String((eventDraft({ title: 'x', date: '2026-10-05' }, 'UTC') as { error: string }).error), /start/);
	assert.match(String((eventDraft({ title: 'x', date: '2026-10-05', start_time: '25:00' }, 'UTC') as { error: string }).error), /start/);
});

test('only real, distinct email addresses become guests', () => {
	const invited = draft({ title: 'x', date: '2026-10-05', all_day: true, guests: ['A@x.com', 'a@x.com', 'izi', 'b@y', 'c@z.org'] });
	assert.deepEqual(invited.guests, ['a@x.com', 'c@z.org']);
	assert.deepEqual(draft({ title: 'x', date: '2026-10-05', all_day: true, guests: 'a@x.com, b@x.com' }).guests, ['a@x.com', 'b@x.com']);
});

test('only busy events that share time are conflicts', () => {
	const call = draft({ title: 'Call', date: '2026-10-05', start_time: '09:00' });
	const event = (title: string, start: string, end: string, busy = true) => ({ title, start, end, allDay: false, busy });
	const checked = withConflicts(
		call,
		[
			event('Standup', '2026-10-05T09:15:00.000Z', '2026-10-05T09:45:00.000Z'),
			event('Lunch', '2026-10-05T09:30:00.000Z', '2026-10-05T10:00:00.000Z'),
			event('Free slot', '2026-10-05T09:00:00.000Z', '2026-10-05T09:30:00.000Z', false)
		],
		'UTC'
	);
	assert.deepEqual(checked.conflicts, ['Standup 09:15–09:45']);
});

test('the model is told the draft is not saved yet', () => {
	const forModel = draftForModel(draft({ title: 'Call', date: '2026-10-05', start_time: '09:00' }), 'UTC');
	assert.equal(forModel.prepared, true);
	assert.equal(forModel.start, 'Mon 2026-10-05 09:00');
	assert.match(forModel.note, /NOT on the calendar/);
});
