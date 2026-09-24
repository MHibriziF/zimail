import { json } from '@sveltejs/kit';
import type { BookingOutcome, PageWriteOutcome } from './service';

const PAGE_ERRORS: Record<Exclude<PageWriteOutcome['type'], 'ok'>, [string, number]> = {
	invalid_title: ['Give the page a title.', 400],
	invalid_slug: ['The link can use lowercase letters, numbers and dashes (3–40 characters).', 400],
	invalid_time_zone: ['Pick a valid time zone.', 400],
	invalid_dates: ['The last date has to be on or after the first, within 180 days.', 400],
	invalid_hours: ['The daily hours must fit at least one slot.', 400],
	invalid_weekdays: ['Pick at least one day of the week.', 400],
	duplicate_slug: ['That link is already taken.', 409],
	limit_reached: ['You have reached the maximum number of reservation pages.', 409],
	not_found: ['Reservation page not found', 404]
};

export function pageWriteResponse(outcome: PageWriteOutcome, okStatus = 200): Response {
	if (outcome.type === 'ok') return json({ page: outcome.page }, { status: okStatus });
	const [error, status] = PAGE_ERRORS[outcome.type];
	return json({ error, code: outcome.type }, { status });
}

const BOOKING_ERRORS: Record<Exclude<BookingOutcome['type'], 'ok'>, [string, number]> = {
	not_found: ['This booking page is not available.', 404],
	invalid_name: ['Please enter your name.', 400],
	invalid_email: ['Please enter a valid email address.', 400],
	slot_taken: ['That time is no longer available. Please pick another.', 409],
	too_many: ['This page can’t take more bookings right now.', 429]
};

export function bookingResponse(outcome: BookingOutcome): Response {
	if (outcome.type === 'ok') {
		return json({ start: outcome.start, end: outcome.end, meetingUrl: outcome.meetingUrl }, { status: 201 });
	}
	const [error, status] = BOOKING_ERRORS[outcome.type];
	return json({ error, code: outcome.type }, { status });
}
