import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	createCaptionUploader,
	createSpeechSegmenter,
	downsample,
	encodeWav,
	livePartials,
	parseCaptionMessage,
	recentCaptions,
	transcriptFilename,
	transcriptText,
	transcriptVtt,
	type CaptionLine
} from '../captions';

const RATE = 1_000;
/** 100 ms frames at a 1 kHz test rate. */
const loud = () => new Float32Array(100).fill(0.5);
const quiet = () => new Float32Array(100);

function segmenter(options = {}) {
	const segments: Float32Array[] = [];
	const instance = createSpeechSegmenter((samples) => segments.push(samples), {
		sampleRate: RATE,
		hangoverMs: 300,
		maxMs: 2_000,
		minSpeechMs: 200,
		preRollMs: 200,
		...options
	});
	return { segments, instance };
}

describe('createSpeechSegmenter', () => {
	test('silence alone never makes a segment', () => {
		const { segments, instance } = segmenter();
		for (let i = 0; i < 50; i++) instance.push(quiet());
		instance.flush();
		assert.equal(segments.length, 0);
	});

	test('speech ends after the hangover, with pre-roll in front and the pause behind', () => {
		const { segments, instance } = segmenter();
		for (let i = 0; i < 5; i++) instance.push(quiet());
		for (let i = 0; i < 5; i++) instance.push(loud());
		for (let i = 0; i < 3; i++) instance.push(quiet());
		assert.equal(segments.length, 1);
		// 200 ms pre-roll + 500 ms speech + 300 ms hangover.
		assert.equal(segments[0].length, 1_000);
		assert.equal(segments[0][0], 0);
		assert.equal(segments[0][200], 0.5);
	});

	test('a short pause between words stays in one segment', () => {
		const { segments, instance } = segmenter();
		instance.push(loud());
		instance.push(loud());
		instance.push(quiet());
		instance.push(quiet());
		instance.push(loud());
		instance.push(loud());
		for (let i = 0; i < 3; i++) instance.push(quiet());
		assert.equal(segments.length, 1);
	});

	test('someone who never pauses is cut at the maximum length', () => {
		const { segments, instance } = segmenter();
		for (let i = 0; i < 45; i++) instance.push(loud());
		assert.equal(segments.length, 2);
		assert.equal(segments[0].length, 2_000);
	});

	test('a click shorter than the minimum is dropped', () => {
		const { segments, instance } = segmenter();
		instance.push(loud());
		for (let i = 0; i < 3; i++) instance.push(quiet());
		assert.equal(segments.length, 0);
	});

	test('flush hands over speech still in progress', () => {
		const { segments, instance } = segmenter();
		for (let i = 0; i < 4; i++) instance.push(loud());
		instance.flush();
		assert.equal(segments.length, 1);
	});

	test('while speech goes on, the segment so far comes out as a partial every so often', () => {
		const partials: number[] = [];
		const { segments, instance } = segmenter({ partialEveryMs: 500, onPartial: (samples: Float32Array) => partials.push(samples.length) });
		for (let i = 0; i < 12; i++) instance.push(loud());
		for (let i = 0; i < 3; i++) instance.push(quiet());
		assert.deepEqual(partials, [500, 1_000]);
		assert.equal(segments.length, 1);
	});

	test('no partial for a pause, or for less than the minimum speech', () => {
		const partials: number[] = [];
		const { instance } = segmenter({ partialEveryMs: 100, minSpeechMs: 300, onPartial: (samples: Float32Array) => partials.push(samples.length) });
		instance.push(loud());
		instance.push(loud());
		instance.push(quiet());
		assert.deepEqual(partials, []);
		instance.push(loud());
		assert.deepEqual(partials, [400]);
	});
});

describe('downsample', () => {
	test('averages each group of samples, and leaves an equal or lower rate alone', () => {
		const frame = new Float32Array([0, 0.3, 0.6, 1, 1, 1]);
		assert.deepEqual([...downsample(frame, 48_000, 16_000)].map((v) => Math.round(v * 10) / 10), [0.3, 1]);
		assert.equal(downsample(frame, 16_000, 16_000), frame);
	});
});

describe('encodeWav', () => {
	test('writes a 16-bit mono header and clamps samples', () => {
		const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
		const view = new DataView(wav.buffer);
		assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
		assert.equal(new TextDecoder().decode(wav.subarray(8, 12)), 'WAVE');
		assert.equal(view.getUint16(22, true), 1);
		assert.equal(view.getUint32(24, true), 16_000);
		assert.equal(view.getUint16(34, true), 16);
		assert.equal(view.getUint32(40, true), 8);
		assert.equal(wav.length, 52);
		assert.equal(view.getInt16(44, true), 0);
		assert.equal(view.getInt16(46, true), 32_767);
		assert.equal(view.getInt16(48, true), -32_768);
		assert.equal(view.getInt16(50, true), 32_767);
	});
});

describe('parseCaptionMessage', () => {
	test('accepts lines and the pause notice, and nothing else', () => {
		assert.deepEqual(parseCaptionMessage('{"type":"line","text":"  hi  "}'), { type: 'line', text: 'hi' });
		assert.deepEqual(parseCaptionMessage('{"type":"paused"}'), { type: 'paused' });
		assert.equal(parseCaptionMessage('{"type":"line","text":"   "}'), null);
		assert.equal(parseCaptionMessage('{"type":"line","text":5}'), null);
		assert.equal(parseCaptionMessage('not json'), null);
		assert.equal((parseCaptionMessage(JSON.stringify({ type: 'line', text: 'x'.repeat(5_000) })) as { text: string }).text.length, 1_000);
	});

	test('a partial may be empty, which takes it down', () => {
		assert.deepEqual(parseCaptionMessage('{"type":"partial","text":" so the "}'), { type: 'partial', text: 'so the' });
		assert.deepEqual(parseCaptionMessage('{"type":"partial","text":""}'), { type: 'partial', text: '' });
		assert.equal(parseCaptionMessage('{"type":"partial"}'), null);
	});
});

describe('createCaptionUploader', () => {
	function setup(respond: (call: number) => Response | Promise<Response>, language?: () => string) {
		const requests: { url: string; init: RequestInit }[] = [];
		const texts: string[] = [];
		const stops: string[] = [];
		const uploader = createCaptionUploader({
			code: 'abc-defg-hij',
			token: 'tok',
			fetch: (async (url: string, init: RequestInit) => {
				requests.push({ url, init });
				return respond(requests.length);
			}) as typeof fetch,
			onText: (text) => texts.push(text),
			onStop: (reason) => stops.push(reason),
			language
		});
		return { uploader, requests, texts, stops };
	}
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

	test('posts the WAV with the caption token and passes non-empty text on', async () => {
		const { uploader, requests, texts } = setup((call) => json({ text: call === 1 ? ' Hello. ' : '' }));
		uploader.send(new Uint8Array([1]));
		uploader.send(new Uint8Array([2]));
		await settle();
		await settle();
		assert.equal(requests[0].url, '/api/meetings/join/abc-defg-hij/captions');
		assert.equal((requests[0].init.headers as Record<string, string>).Authorization, 'Bearer tok');
		assert.deepEqual(texts, ['Hello.']);
		assert.equal((requests[0].init.headers as Record<string, string>)['X-Caption-Language'], '');
	});

	test('sends the language chosen at the time of each segment', async () => {
		let language = 'en';
		const { uploader, requests } = setup(() => json({ text: 'x' }), () => language);
		uploader.send(new Uint8Array([1]));
		await settle();
		await settle();
		language = 'id';
		uploader.send(new Uint8Array([2]));
		await settle();
		await settle();
		const sent = requests.map((request) => (request.init.headers as Record<string, string>)['X-Caption-Language']);
		assert.deepEqual(sent, ['en', 'id']);
	});

	test('when the Worker falls behind, the oldest waiting segment is dropped', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { uploader, requests } = setup(async () => {
			await gate;
			return json({ text: '' });
		});
		for (let i = 1; i <= 5; i++) uploader.send(new Uint8Array([i]));
		release();
		for (let i = 0; i < 5; i++) await settle();
		assert.deepEqual(
			requests.map((r) => (r.init.body as Uint8Array)[0]),
			[1, 4, 5]
		);
	});

	test('stops for good on the daily limit, and says why', async () => {
		const { uploader, requests, stops } = setup(() => json({ error: 'limit_reached' }, 429));
		uploader.send(new Uint8Array([1]));
		await settle();
		uploader.send(new Uint8Array([2]));
		await settle();
		assert.deepEqual(stops, ['limit']);
		assert.equal(requests.length, 1);
	});

	test('a failed or dropped request just loses that segment', async () => {
		const { uploader, requests, stops } = setup((call) => {
			if (call === 1) throw new Error('offline');
			return json({ error: 'failed' }, 502);
		});
		uploader.send(new Uint8Array([1]));
		await settle();
		uploader.send(new Uint8Array([2]));
		await settle();
		assert.equal(requests.length, 2);
		assert.deepEqual(stops, []);
	});
});

describe('createCaptionUploader partials', () => {
	type Pending = { body: number; resolve: (text: string) => void };

	/** Every request waits until the test answers it, so answers can come back in any order. */
	function setup() {
		const pending: Pending[] = [];
		const events: string[] = [];
		const uploader = createCaptionUploader({
			code: 'c',
			token: 't',
			fetch: ((_url: string, init: RequestInit) =>
				new Promise<Response>((resolve) => {
					pending.push({
						body: (init.body as Uint8Array)[0],
						resolve: (text) => resolve(new Response(JSON.stringify({ text })))
					});
				})) as typeof fetch,
			onText: (text) => events.push(`line:${text}`),
			onPartial: (text) => events.push(`partial:${text}`),
			onStop: () => {}
		});
		const answer = async (body: number, text: string) => {
			pending.find((request) => request.body === body)?.resolve(text);
			for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
		};
		return { uploader, pending, events, answer };
	}

	test('partials show as they come back, and the line replaces them', async () => {
		const { uploader, events, answer } = setup();
		uploader.sendPartial(new Uint8Array([1]));
		await answer(1, 'Can we');
		uploader.send(new Uint8Array([2]));
		await answer(2, 'Can we move it?');
		assert.deepEqual(events, ['partial:Can we', 'line:Can we move it?']);
	});

	test('an older partial answering late never overwrites a newer one', async () => {
		const { uploader, events, answer } = setup();
		uploader.sendPartial(new Uint8Array([1]));
		uploader.sendPartial(new Uint8Array([2]));
		await answer(2, 'Can we move');
		await answer(1, 'Can');
		assert.deepEqual(events, ['partial:Can we move']);
	});

	test('a partial still shows after its segment ended, until the line arrives', async () => {
		const { uploader, events, answer } = setup();
		uploader.sendPartial(new Uint8Array([1]));
		uploader.send(new Uint8Array([2]));
		await answer(1, 'Can');
		await answer(2, 'Can we?');
		assert.deepEqual(events, ['partial:Can', 'line:Can we?']);
	});

	test('a partial answering after its line is dropped', async () => {
		const { uploader, events, answer } = setup();
		uploader.sendPartial(new Uint8Array([1]));
		uploader.send(new Uint8Array([2]));
		await answer(2, 'Can we?');
		await answer(1, 'Can');
		assert.deepEqual(events, ['line:Can we?']);
	});

	test('a line for an earlier segment keeps the next segment’s partial up', async () => {
		const { uploader, events, answer } = setup();
		uploader.send(new Uint8Array([1]));
		uploader.sendPartial(new Uint8Array([2]));
		await answer(2, 'And then');
		await answer(1, 'First.');
		assert.deepEqual(events, ['partial:And then', 'line:First.', 'partial:And then']);
	});

	test('an empty line takes the partial down', async () => {
		const { uploader, events, answer } = setup();
		uploader.sendPartial(new Uint8Array([1]));
		await answer(1, 'Uh');
		uploader.send(new Uint8Array([2]));
		await answer(2, '');
		assert.deepEqual(events, ['partial:Uh', 'partial:']);
	});

	test('at most three partials are in flight; the rest are skipped', async () => {
		const { uploader, pending } = setup();
		for (let i = 1; i <= 5; i++) uploader.sendPartial(new Uint8Array([i]));
		assert.deepEqual(
			pending.map((request) => request.body),
			[1, 2, 3]
		);
	});
});

describe('livePartials', () => {
	test('drops partials older than the limit, oldest first', () => {
		const partial = (identity: string, at: number) => ({ identity, name: identity, text: identity, at });
		assert.deepEqual(
			livePartials([partial('b', 9_000), partial('a', 5_000), partial('old', 0)], 10_000).map((p) => p.identity),
			['a', 'b']
		);
	});
});

const line = (text: string, at: number, name = 'Ada'): CaptionLine => ({ id: `${at}`, identity: name, name, text, at });

describe('recentCaptions', () => {
	test('keeps the newest few inside the window, oldest first', () => {
		const lines = [line('a', 0), line('b', 5_000), line('c', 6_000), line('d', 7_000), line('e', 8_000)];
		assert.deepEqual(
			recentCaptions(lines, 9_000).map((l) => l.text),
			['c', 'd', 'e']
		);
		assert.deepEqual(recentCaptions(lines, 20_000), []);
	});
});

describe('transcript export', () => {
	const lines = [line('Hello.', Date.UTC(2026, 9, 5, 14, 5, 12)), line('Hi --> there', Date.UTC(2026, 9, 5, 14, 5, 20), 'Bo>b')];

	test('text has a timestamp and speaker per line', () => {
		assert.equal(transcriptText(lines, 'UTC'), '[14:05:12] Ada: Hello.\n[14:05:20] Bo>b: Hi --> there\n');
	});

	test('VTT cues run until the next line, at most five seconds', () => {
		assert.equal(
			transcriptVtt(lines),
			'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n<v Ada>Hello.\n\n00:00:08.000 --> 00:00:13.000\n<v Bob>Hi -> there\n'
		);
		assert.equal(transcriptVtt([]), 'WEBVTT\n');
	});

	test('filenames follow the recording convention', () => {
		const at = new Date(2026, 8, 24, 14, 5);
		assert.equal(transcriptFilename('abc-defg-hij', at, 'vtt'), 'transcript-abc-defg-hij-2026-09-24-1405.vtt');
		assert.equal(transcriptFilename('../', at, 'txt'), 'transcript-2026-09-24-1405.txt');
	});
});
