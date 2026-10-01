import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	eventRange,
	eventsForModel,
	filterEvents,
	findMessages,
	localStamp,
	pickCards,
	plainAnswer,
	searchArgs,
	searchResultForModel,
	toolCalls,
	validTimeZone,
	widenings,
	type EventRange,
	type FoundEvent,
	type FoundMessage,
	type MessageDetail
} from '../find';
import { createAiService, type AiBinding } from '../service';

const invoice: FoundMessage = {
	id: 'e1',
	threadId: 't1',
	direction: 'inbound',
	from: 'Budi <budi@example.com>',
	to: 'me@example.com',
	subject: 'Invoice #442',
	createdAt: '2026-08-28 15:06:00',
	snippet: 'Please find attached invoice #442.',
	hasAttachments: true
};

test("the model's search arguments are cleaned before they reach SQL", () => {
	assert.deepEqual(
		searchArgs({ text: '  invoice  a  August 2026 x y z w ', from: ' Budi ', after: '2026-08-01', before: 'last week', folder: 'drafts', unread: 'yes', has_attachment: true }),
		{
			terms: ['invoice', 'August', '2026'],
			from: 'Budi',
			after: '2026-08-01',
			before: null,
			view: 'all',
			unreadOnly: false,
			attachmentsOnly: true,
			anyTerm: false
		}
	);
	assert.equal(searchArgs({ folder: 'sent' }).view, 'sent');
	assert.deepEqual(searchArgs({}).terms, []);
});

test('an empty search widens to any word, then to any date', () => {
	const steps = widenings(searchArgs({ text: 'invoice due', from: 'Budi', after: '2026-08-01', before: '2026-09-01' }));
	assert.deepEqual(
		steps.map(({ args }) => [args.anyTerm, args.after, args.from]),
		[
			[false, '2026-08-01', 'Budi'],
			[true, '2026-08-01', 'Budi'],
			[true, null, 'Budi']
		]
	);
	assert.equal(steps[0].note, null);
	assert.equal(widenings(searchArgs({ text: 'invoice' })).length, 1);
});

test('tool calls are read from the OpenAI shape and Workers AI’s own', () => {
	assert.deepEqual(
		toolCalls({ choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'search_mail', arguments: '{"text":"invoice"}' } }] } }] }),
		[{ id: 'c1', name: 'search_mail', args: { text: 'invoice' } }]
	);
	assert.deepEqual(toolCalls({ tool_calls: [{ name: 'read_message', arguments: { id: 'e1' } }] }), [
		{ id: 'call_0', name: 'read_message', args: { id: 'e1' } }
	]);
	assert.deepEqual(toolCalls({ tool_calls: [{ name: 'x', arguments: '{bad' }] }), [{ id: 'call_0', name: 'x', args: {} }]);
	assert.deepEqual(toolCalls({ response: 'hi' }), []);
});

test('dates are shown to the model in the reader’s zone', () => {
	assert.equal(localStamp('2026-09-29 15:06:00', 'Asia/Jakarta'), 'Tue 2026-09-29 22:06');
	assert.equal(localStamp('2026-09-29 20:00:00', 'Asia/Jakarta'), 'Wed 2026-09-30 03:00');
	assert.equal(validTimeZone('Mars/Olympus'), 'UTC');
	assert.equal(validTimeZone(undefined), 'UTC');
	assert.equal(validTimeZone('Asia/Jakarta'), 'Asia/Jakarta');
});

test('the prompt knows today, keeps recent history only, and search results are compact', () => {
	const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }) as const);
	const messages = findMessages({ question: 'invoice?', history, timeZone: 'Asia/Jakarta', now: new Date('2026-09-29T20:00:00Z') });
	assert.match(messages[0].content, /\(2026-09-30\)/);
	assert.match(messages[0].content, /last month is after 2026-08-01, before 2026-09-01; this month is after 2026-09-01, before 2026-10-01/);
	assert.equal(messages.length, 1 + 6 + 1);
	assert.equal(messages.at(-1)?.content, 'invoice?');
	assert.match(JSON.stringify(searchResultForModel([], 'UTC')), /Nothing matched/);
	assert.equal(searchResultForModel([invoice], 'Asia/Jakarta').results?.[0].date, 'Fri 2026-08-28 22:06');
});

test('stray Markdown and reasoning are stripped from the answer', () => {
	assert.equal(plainAnswer('<think>x</think>\n\n## Found\n**Invoice #442** from Budi'), 'Found\nInvoice #442 from Budi');
});

/** A model that follows a script: each entry is what one call returns. */
function scripted(steps: unknown[]) {
	const calls: Record<string, unknown>[] = [];
	const ai: AiBinding = {
		async run(_model, inputs) {
			calls.push(structuredClone(inputs));
			return steps[Math.min(calls.length - 1, steps.length - 1)];
		}
	};
	return { ai, calls };
}

const callTool = (name: string, args: object) => ({ tool_calls: [{ name, arguments: args }] });

function service(ai: AiBinding | null, found: FoundMessage[] = [invoice], events: FoundEvent[] = []) {
	const searched: unknown[] = [];
	const listed: EventRange[] = [];
	const detail: MessageDetail = { ...invoice, text: 'Total Rp 4.500.000, due 10 September.' };
	const svc = createAiService({
		ai,
		async searchMail(_userId, args) {
			searched.push(args);
			return found;
		},
		readMessage: async (_userId, id) => (id === 'e1' ? detail : null),
		listEvents: async (_userId, range) => {
			listed.push(range);
			return events;
		},
		now: () => new Date('2026-09-30T02:00:00Z')
	});
	return { svc, searched, listed };
}

test('find searches, reads, and answers with the message it read', async () => {
	const { ai, calls } = scripted([
		callTool('search_mail', { text: 'invoice', from: 'Budi' }),
		callTool('read_message', { id: 'e1' }),
		{ response: 'Budi sent Invoice #442 on 28 August; it is due 10 September.' }
	]);
	const { svc, searched } = service(ai);
	const outcome = await svc.find('u1', { question: 'when is Budi’s invoice due?', history: [], timeZone: 'Asia/Jakarta' });
	assert.equal(outcome.kind, 'ok');
	assert.ok(outcome.kind === 'ok' && outcome.answer.includes('10 September'));
	assert.deepEqual(outcome.kind === 'ok' && outcome.messages.map((m) => m.id), ['e1']);
	assert.equal((searched[0] as { from: string }).from, 'Budi');
	const lastMessages = calls[2].messages as { role: string; content: string }[];
	assert.deepEqual(lastMessages.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'tool']);
	assert.match(lastMessages.at(-1)!.content, /Rp 4\.500\.000/);
});

test('a model that keeps searching is made to answer on the last turn', async () => {
	const { ai, calls } = scripted([callTool('search_mail', { text: 'x' })]);
	const outcome = await service(ai).svc.find('u1', { question: 'x', history: [], timeZone: 'UTC' });
	assert.equal(calls.length, 4);
	assert.equal(calls[3].tools, undefined);
	// The script's last entry is still a tool call with no text, so there's nothing to show.
	assert.deepEqual(outcome, { kind: 'failed' });
});

test('without reading anything, the newest search results are the cards', async () => {
	const { ai } = scripted([callTool('search_mail', { text: 'invoice' }), { response: 'Found it.' }]);
	const outcome = await service(ai).svc.find('u1', { question: 'invoice', history: [], timeZone: 'UTC' });
	assert.deepEqual(outcome.kind === 'ok' && outcome.messages.map((m) => m.id), ['e1']);
});

test('cards: what was read, else an exact search, else only loose matches the answer names', () => {
	const other = { ...invoice, id: 'e2', subject: 'Project review' };
	assert.deepEqual(pickCards([other], { found: [invoice], loose: false }, ''), [other]);
	assert.deepEqual(pickCards([], { found: [invoice, other], loose: false }, ''), [invoice, other]);
	assert.deepEqual(pickCards([], { found: [invoice, other], loose: true }, 'See "invoice #442" from Budi.'), [invoice]);
	assert.deepEqual(pickCards([], { found: [invoice], loose: true }, 'Nothing about a loan.'), []);
});

test('loosened matches are not shown as cards unless the model read them', async () => {
	const { ai } = scripted([callTool('search_mail', { text: 'loan bank' }), { response: 'Nothing about a loan.' }]);
	const searches: boolean[] = [];
	const svc = createAiService({
		ai,
		async searchMail(_userId, args) {
			searches.push(args.anyTerm);
			return args.anyTerm ? [invoice] : [];
		},
		readMessage: async () => null,
		listEvents: async () => []
	});
	const outcome = await svc.find('u1', { question: 'loan from my bank?', history: [], timeZone: 'UTC' });
	assert.deepEqual(searches, [false, true]);
	assert.deepEqual(outcome, { kind: 'ok', answer: 'Nothing about a loan.', messages: [], events: [] });
});

const standup: FoundEvent = {
	id: 'ev1',
	title: 'Standup',
	start: '2026-10-01T02:00:00.000Z',
	end: '2026-10-01T02:30:00.000Z',
	allDay: false,
	location: 'Room 3',
	calendar: null,
	busy: true,
	day: '2026-10-01'
};
const holiday: FoundEvent = {
	...standup,
	id: 'ev2',
	title: 'Holiday',
	start: '2026-10-02T00:00:00.000Z',
	end: '2026-10-04T00:00:00.000Z',
	allDay: true,
	location: null,
	calendar: 'Google',
	busy: false,
	day: '2026-10-02'
};

test('calendar ranges default to the coming week, are put the right way round and capped at a month', () => {
	assert.deepEqual(eventRange({}, '2026-09-30'), { after: '2026-09-30', before: '2026-10-07', text: null });
	assert.deepEqual(eventRange({ after: '2026-10-05', before: '2026-10-01' }, '2026-09-30'), {
		after: '2026-10-05',
		before: '2026-10-06',
		text: null
	});
	assert.equal(eventRange({ after: '2026-10-01', before: '2027-01-01' }, '2026-09-30').before, '2026-11-01');
	assert.equal(eventRange({ after: 'tomorrow', text: ' dentist ' }, '2026-09-30').after, '2026-09-30');
	assert.equal(eventRange({ text: ' dentist ' }, '2026-09-30').text, 'dentist');
	assert.equal(eventRange({ text: 'dentist' }, '2026-09-30').before, '2026-10-31', 'a named event looks a month ahead');
	assert.equal(eventRange({ text: 'dentist', before: '2026-10-02' }, '2026-09-30').before, '2026-10-02');
});

test('events reach the model in the reader’s zone; all-day ones as dates', () => {
	const range = eventRange({}, '2026-09-30');
	const shown = eventsForModel([standup, holiday], range, 'Asia/Jakarta');
	assert.deepEqual(shown.events, [
		{ title: 'Standup', start: 'Thu 2026-10-01 09:00', end: 'Thu 2026-10-01 09:30', location: 'Room 3', calendar: 'own', busy: true },
		{ title: 'Holiday', start: 'Fri 2026-10-02', end: 'Sat 2026-10-03', all_day: true, location: null, calendar: 'Google', busy: false }
	]);
	assert.match(JSON.stringify(eventsForModel([], range, 'UTC')), /the time is free/);
	assert.deepEqual(filterEvents([standup, holiday], { ...range, text: 'room 3' }), { events: [standup], note: null });
	// A weekday passed as the name must not make a busy day look free.
	const fallback = filterEvents([standup, holiday], { ...range, text: 'Tuesday' });
	assert.deepEqual(fallback.events, [standup, holiday]);
	assert.match(JSON.stringify(eventsForModel(fallback.events, range, 'UTC', fallback.note)), /No event is named \\"Tuesday\\"/);
});

test('the prompt spells out today, tomorrow and the weeks', () => {
	const [system] = findMessages({ question: 'x', history: [], timeZone: 'Asia/Jakarta', now: new Date('2026-09-30T02:00:00Z') });
	assert.match(system.content, /tomorrow is after 2026-10-01, before 2026-10-02/);
	assert.match(system.content, /this week is after 2026-09-28, before 2026-10-05/);
	assert.match(system.content, /next week is after 2026-10-05, before 2026-10-12/);
	assert.match(system.content, /The next seven days are Thu 2026-10-01, Fri 2026-10-02, .*, Wed 2026-10-07\./);
	assert.match(system.content, /list_events/);
});

test('a schedule question lists events and returns them as cards', async () => {
	const { ai, calls } = scripted([
		callTool('list_events', { after: '2026-10-01', before: '2026-10-02' }),
		{ response: 'Tomorrow you have Standup at 09:00 in Room 3.' }
	]);
	const { svc, listed } = service(ai, [], [standup]);
	const outcome = await svc.find('u1', { question: 'what do I have tomorrow?', history: [], timeZone: 'Asia/Jakarta' });
	assert.deepEqual(listed, [{ after: '2026-10-01', before: '2026-10-02', text: null }]);
	assert.deepEqual(outcome.kind === 'ok' && outcome.events, [standup]);
	assert.match((calls[1].messages as { content: string }[]).at(-1)!.content, /Thu 2026-10-01 09:00/);
});

test('find reports the daily limit and a missing binding', async () => {
	const exhausted: AiBinding = { run: async () => Promise.reject(new Error('4006: daily free allocation')) };
	const input = { question: 'x', history: [], timeZone: 'UTC' };
	assert.deepEqual(await service(exhausted).svc.find('u1', input), { kind: 'limit_reached' });
	assert.deepEqual(await service(null).svc.find('u1', input), { kind: 'unavailable' });
});
