import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AiBinding } from '../service';
import { CAPTION_MODEL, transcribeSpeech } from '../transcribe';

function scripted(answer: () => unknown): { ai: AiBinding; calls: { model: string; inputs: Record<string, unknown> }[] } {
	const calls: { model: string; inputs: Record<string, unknown> }[] = [];
	return {
		calls,
		ai: {
			async run(model, inputs) {
				calls.push({ model, inputs });
				return answer();
			}
		}
	};
}

describe('transcribeSpeech', () => {
	test('sends the audio as base64 with the voice filter on, and trims the text', async () => {
		const { ai, calls } = scripted(() => ({ text: '  Hello there.  ' }));
		const outcome = await transcribeSpeech(ai, new Uint8Array([82, 73, 70, 70]));
		assert.deepEqual(outcome, { kind: 'text', text: 'Hello there.' });
		assert.equal(calls[0].model, CAPTION_MODEL);
		assert.equal(calls[0].inputs.audio, 'UklGRg==');
		assert.equal(calls[0].inputs.vad_filter, true);
		assert.equal(calls[0].inputs.condition_on_previous_text, false);
	});

	test('encodes audio longer than one String.fromCodePoint batch', async () => {
		const { ai, calls } = scripted(() => ({ text: '' }));
		const audio = new Uint8Array(100_000).fill(65);
		await transcribeSpeech(ai, audio);
		assert.equal(Buffer.from(calls[0].inputs.audio as string, 'base64').length, 100_000);
	});

	test('no text is an empty caption, not a failure', async () => {
		const { ai } = scripted(() => ({}));
		assert.deepEqual(await transcribeSpeech(ai, new Uint8Array(1)), { kind: 'text', text: '' });
	});

	test('without a language Whisper guesses, and one language is passed outright', async () => {
		const guessed = scripted(() => ({ text: 'Halo' }));
		await transcribeSpeech(guessed.ai, new Uint8Array(1));
		assert.equal('language' in guessed.calls[0].inputs, false);

		const fixed = scripted(() => ({ text: 'Halo' }));
		await transcribeSpeech(fixed.ai, new Uint8Array(1), 'id');
		assert.equal(fixed.calls.length, 1);
		assert.equal(fixed.calls[0].inputs.language, 'id');
	});

	test('tells the daily limit apart from other failures', async () => {
		const limited = scripted(() => {
			throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
		});
		assert.deepEqual(await transcribeSpeech(limited.ai, new Uint8Array(1)), { kind: 'limit_reached' });

		const broken = scripted(() => {
			throw new Error('boom');
		});
		const originalError = console.error;
		console.error = () => {};
		try {
			assert.deepEqual(await transcribeSpeech(broken.ai, new Uint8Array(1)), { kind: 'failed' });
		} finally {
			console.error = originalError;
		}
	});
});
