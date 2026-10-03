import type { CalendarEvent } from '$lib/calendar/events';
import { dateKeyIn } from '$lib/calendar/grid';
import { instantFromWall } from '$lib/timezone';
import type { EmailRow } from '$lib/types';
import { stripTags } from '$lib/utils/text';
import { calendarServiceFor } from '../calendar';
import { getMailStoreService } from '../mail-store';
import type { ThreadMessageRow } from '../mail-store/repository';
import type { FoundEvent, FoundMessage } from './find';
import { createAiService, type AiService } from './service';

export { COMPOSE_ACTIONS, type ComposeAction } from './prompt';
export { MAX_QUESTION_CHARS, type FoundEvent, type FoundMessage, type HistoryTurn } from './find';
export { createAiService, type AiBinding, type AiService, type ComposeOutcome, type FindOutcome } from './service';
export { sortTabs, type TabMessage, type TabsOutcome } from './tabs';
export type { EventDraft } from './draft';

type PlatformLike = App.Platform | undefined | null;

function sender(row: { from_addr: string; from_name: string | null }): string {
	return row.from_name ? `${row.from_name} <${row.from_addr}>` : row.from_addr;
}

function toFound(row: ThreadMessageRow | EmailRow, snippet: string, hasAttachments: boolean): FoundMessage {
	return {
		id: row.id,
		threadId: row.thread_id ?? row.id,
		direction: row.direction,
		from: sender(row),
		to: row.to_addr,
		subject: row.subject,
		createdAt: row.created_at,
		snippet,
		hasAttachments
	};
}

/** Midnight of a `YYYY-MM-DD` in the reader's zone. */
function startOfDay(day: string, timeZone: string): Date {
	const [year, month, date] = day.split('-').map(Number);
	return instantFromWall({ year, month, day: date }, timeZone);
}

function toFoundEvent(event: CalendarEvent, timeZone: string): FoundEvent {
	return {
		id: event.id,
		title: event.title,
		start: event.start,
		end: event.end,
		allDay: event.allDay,
		location: event.location,
		calendar: event.calendar?.name ?? null,
		busy: event.busy,
		// All-day events are floating dates; timed ones start on whatever day it is in the reader's zone.
		day: event.allDay ? event.start.slice(0, 10) : dateKeyIn(new Date(event.start), timeZone)
	};
}

/** Composition root for routes. Works without the AI binding and reports `unavailable`. */
export function getAiService(platform: PlatformLike): AiService {
	const mailStore = getMailStoreService(platform);
	return createAiService({
		ai: platform?.env.AI ?? null,
		async searchMail(userId, args, limit) {
			const rows = await mailStore.searchMessages(
				userId,
				{
					view: args.view,
					terms: args.terms,
					from: args.from,
					after: args.after,
					before: args.before,
					unreadOnly: args.unreadOnly,
					attachmentsOnly: args.attachmentsOnly,
					anyTerm: args.anyTerm
				},
				limit
			);
			return rows.map((row) => toFound(row, row.body_head ?? '', Boolean(row.has_attachments)));
		},
		async listEvents(userId, range, timeZone) {
			const db = platform?.env.DB;
			if (!db) return [];
			const outcome = await calendarServiceFor(db).listBetween(
				userId,
				startOfDay(range.after, timeZone),
				startOfDay(range.before, timeZone),
				timeZone
			);
			return outcome.type === 'ok' ? outcome.events.map((event) => toFoundEvent(event, timeZone)) : [];
		},
		async readMessage(userId, emailId) {
			const email = await mailStore.getEmailForUser(userId, emailId);
			if (!email || email.status === 'draft') return null;
			const text = email.body_text?.trim() || stripTags(email.body_html ?? '');
			return { ...toFound(email, text.slice(0, 200), false), text };
		}
	});
}
