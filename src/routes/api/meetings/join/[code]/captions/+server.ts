import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMeetingsService } from '$lib/server/meet/meetings';
import { MAX_CAPTION_AUDIO_BYTES, transcribeSpeech } from '$lib/server/ai/transcribe';
import { CAPTION_LANGUAGE_HEADER, captionLanguages } from '$lib/meet/caption-language';

/**
 * One spoken segment from a participant's own mic, as WAV, back as text. The
 * participant broadcasts the text to the room themselves. Public like the rest
 * of join/: the caption token minted at admission is the credential, and the
 * host's setting is checked on every call so turning captions off stops
 * spending at once.
 */
export const POST: RequestHandler = async ({ params, request, platform }) => {
	if (!platform?.env.DB) return json({ error: 'Database unavailable' }, { status: 503 });
	if (!platform.env.AI) return json({ error: 'AI unavailable' }, { status: 503 });

	const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
	if (!token) return json({ error: 'Unauthorized' }, { status: 401 });

	const declaredLength = Number(request.headers.get('content-length') ?? 0);
	if (declaredLength > MAX_CAPTION_AUDIO_BYTES) return json({ error: 'Too long' }, { status: 413 });

	try {
		const access = await getMeetingsService(platform).checkCaptionsAccess(params.code, token);
		if (access === 'meeting_not_found') return json({ error: 'Meeting not found' }, { status: 404 });
		if (access === 'unauthorized') return json({ error: 'Unauthorized' }, { status: 401 });
		if (access === 'disabled') return json({ error: 'Captions are off' }, { status: 403 });
	} catch {
		return json({ error: 'Meetings are not configured' }, { status: 503 });
	}

	const audio = new Uint8Array(await request.arrayBuffer());
	if (audio.byteLength === 0) return json({ error: 'No audio' }, { status: 400 });
	if (audio.byteLength > MAX_CAPTION_AUDIO_BYTES) return json({ error: 'Too long' }, { status: 413 });

	const languages = captionLanguages(request.headers.get(CAPTION_LANGUAGE_HEADER));
	const outcome = await transcribeSpeech(platform.env.AI, audio, languages);
	if (outcome.kind === 'limit_reached') return json({ error: 'limit_reached' }, { status: 429 });
	if (outcome.kind === 'failed') return json({ error: 'failed' }, { status: 502 });
	return json({ text: outcome.text });
};
