import { json } from '@sveltejs/kit';
import type { FeedWriteOutcome } from './service';

/** One mapping from service outcome to HTTP, shared by add, update and sync. */
export function feedWriteResponse(outcome: FeedWriteOutcome, okStatus = 200): Response {
	switch (outcome.type) {
		case 'ok':
			return json({ feed: outcome.feed }, { status: okStatus });
		case 'invalid_name':
			return json({ error: 'Give the calendar a name.' }, { status: 400 });
		case 'invalid_url':
			return json({ error: 'Paste the calendar’s https:// or webcal:// iCal address.' }, { status: 400 });
		case 'limit_reached':
			return json({ error: 'You have reached the maximum number of calendars.' }, { status: 409 });
		case 'not_found':
			return json({ error: 'Calendar not found' }, { status: 404 });
	}
}
