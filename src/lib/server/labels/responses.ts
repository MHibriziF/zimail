import { json } from '@sveltejs/kit';
import type { LabelWriteOutcome } from './service';

/** One mapping from service outcome to HTTP, shared by create and update. */
export function labelWriteResponse(outcome: LabelWriteOutcome, okStatus = 200): Response {
	switch (outcome.type) {
		case 'ok':
			return json({ label: outcome.label }, { status: okStatus });
		case 'invalid_name':
			return json({ error: 'Give the label a name.' }, { status: 400 });
		case 'duplicate_name':
			return json({ error: 'You already have a label with that name.' }, { status: 409 });
		case 'limit_reached':
			return json({ error: 'You have reached the maximum number of labels.' }, { status: 409 });
		case 'not_found':
			return json({ error: 'Label not found' }, { status: 404 });
	}
}
