import { createOpenAiCompatible } from './openai-compatible';
import type { AiBinding } from './service';
import { createWorkersAiRest } from './workers-ai-rest';

/** The settings `AI_PROVIDER` reads, as found on `platform.env`. */
export type AiEnv = {
	AI?: AiBinding;
	/** Unset or `workers-ai`: the binding. `workers-ai-rest` or `openai`: see below. */
	AI_PROVIDER?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_AI_TOKEN?: string;
	AI_BASE_URL?: string;
	AI_MODEL?: string;
	AI_API_KEY?: string;
	AI_TRANSCRIPTION_MODEL?: string;
};

function warn(message: string): null {
	console.error(`AI disabled: ${message}`);
	return null;
}

/**
 * The AI this install is set up for, or `null` when there is none: the
 * features then hide, and inbox tabs fall back to the header rules. On
 * Cloudflare with nothing set, it's the Workers AI binding, as before.
 */
export function aiFromEnv(env: AiEnv | null | undefined): AiBinding | null {
	const provider = env?.AI_PROVIDER?.trim().toLowerCase() || 'workers-ai';
	switch (provider) {
		case 'workers-ai':
			return env?.AI ?? null;
		case 'workers-ai-rest': {
			const accountId = env?.CLOUDFLARE_ACCOUNT_ID?.trim();
			const token = env?.CLOUDFLARE_AI_TOKEN?.trim();
			if (!accountId || !token) return warn('workers-ai-rest needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN.');
			return createWorkersAiRest({ accountId, token });
		}
		case 'openai': {
			const baseUrl = env?.AI_BASE_URL?.trim();
			const model = env?.AI_MODEL?.trim();
			if (!baseUrl || !model) return warn('openai needs AI_BASE_URL and AI_MODEL.');
			return createOpenAiCompatible({
				baseUrl,
				model,
				apiKey: env?.AI_API_KEY?.trim() || undefined,
				transcriptionModel: env?.AI_TRANSCRIPTION_MODEL?.trim() || undefined
			});
		}
		case 'none':
			return null;
		default:
			return warn(`unknown AI_PROVIDER "${env?.AI_PROVIDER}". Use workers-ai, workers-ai-rest, openai or none.`);
	}
}
