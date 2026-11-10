import type { AiBinding } from './service';

/**
 * Workers AI over its REST API, for installs without the binding (a VPS). Same
 * models, same free daily allowance, billed to the account the token belongs to.
 * Errors keep Cloudflare's code in the message, so "4006" still reads as the
 * daily limit.
 */
export type WorkersAiRestOptions = {
	accountId: string;
	token: string;
	fetch?: typeof fetch;
};

type RestEnvelope = { success?: boolean; result?: unknown; errors?: { code?: number; message?: string }[] };

function describeErrors(envelope: RestEnvelope | null, status: number): string {
	const errors = envelope?.errors ?? [];
	if (errors.length === 0) return `Workers AI request failed (${status})`;
	return errors.map((error) => `${error.code ?? status}: ${error.message ?? 'error'}`).join('; ');
}

export function createWorkersAiRest({ accountId, token, fetch: send = fetch }: WorkersAiRestOptions): AiBinding {
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/`;
	return {
		async run(model, inputs) {
			const response = await send(base + model, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify(inputs)
			});
			const envelope = (await response.json().catch(() => null)) as RestEnvelope | null;
			if (!response.ok || envelope?.success === false) throw new Error(describeErrors(envelope, response.status));
			return envelope?.result ?? null;
		}
	};
}
