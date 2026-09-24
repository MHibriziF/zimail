import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CalendarEvent } from '../../../calendar/events';
import type { CalendarRepository } from '../../calendar/repository';
import type { BookingDetails } from '../email';
import type { NewBooking, ReservationsRepository, StoredPage } from '../repository';
import { createReservationsService, MAX_UPCOMING_PER_GUEST } from '../service';

const NOW = new Date('2026-09-24T00:00:00.000Z');

const body = {
	title: 'Office hours',
	slug: 'office-hours',
	timeZone: 'Asia/Jakarta',
	startDate: '2026-09-28',
	endDate: '2026-10-09',
	weekdays: [1, 2, 3, 4, 5],
	dayStart: 540,
	dayEnd: 720,
	slotMinutes: 60,
	bufferMinutes: 0,
	noticeMinutes: 0
};

type SetupOptions = { busy?: CalendarEvent[]; notifyFails?: boolean };

function setup(options: SetupOptions = {}) {
	const pages: StoredPage[] = [];
	const bookings: NewBooking[] = [];
	const notified: { hostUserId: string; booking: BookingDetails; kind: string }[] = [];
	const deletedEvents: string[] = [];

	const repo: ReservationsRepository = {
		async listForUser(userId) {
			return pages.filter((page) => page.userId === userId);
		},
		async countForUser(userId) {
			return pages.filter((page) => page.userId === userId).length;
		},
		async get(userId, id) {
			return pages.find((page) => page.userId === userId && page.id === id) ?? null;
		},
		async getBySlug(slug) {
			return pages.find((page) => page.slug === slug) ?? null;
		},
		async insert(page) {
			if (pages.some((entry) => entry.slug === page.slug)) throw new Error('UNIQUE constraint failed: reservation_pages.slug');
			pages.push({ ...page });
		},
		async update(userId, id, settings) {
			const page = pages.find((entry) => entry.userId === userId && entry.id === id);
			if (!page) return false;
			Object.assign(page, settings);
			return true;
		},
		async delete(userId, id) {
			const index = pages.findIndex((entry) => entry.userId === userId && entry.id === id);
			if (index < 0) return false;
			pages.splice(index, 1);
			return true;
		},
		async countCreatedSince(pageId) {
			return bookings.filter((booking) => booking.pageId === pageId).length;
		},
		async countUpcomingFor(pageId, email) {
			return bookings.filter((booking) => booking.pageId === pageId && booking.guestEmail === email).length;
		},
		async getBookingByEvent(userId, eventId) {
			const booking = bookings.find((entry) => entry.userId === userId && entry.eventId === eventId);
			if (!booking) return null;
			const page = pages.find((entry) => entry.id === booking.pageId)!;
			return {
				guestName: booking.guestName,
				guestEmail: booking.guestEmail,
				note: booking.note,
				start: booking.start,
				end: booking.end,
				pageTitle: page.title,
				timeZone: page.timeZone
			};
		},
		async insertBooking(booking) {
			if (bookings.some((entry) => entry.pageId === booking.pageId && entry.start === booking.start)) {
				throw new Error('UNIQUE constraint failed: reservations.page_id, reservations.starts_at');
			}
			bookings.push(booking);
		}
	};

	const calendar = {
		async deleteReservation(userId: string, eventId: string) {
			const index = bookings.findIndex((entry) => entry.userId === userId && entry.eventId === eventId);
			if (index < 0) return false;
			bookings.splice(index, 1);
			deletedEvents.push(eventId);
			return true;
		},
		async listOverlapping(userId: string) {
			const booked: CalendarEvent[] = bookings
				.filter((booking) => booking.userId === userId)
				.map((booking) => ({
					id: booking.eventId,
					title: booking.eventTitle,
					start: booking.start,
					end: booking.end,
					allDay: false,
					location: null,
					notes: null,
					source: 'reservation',
					busy: true,
					calendar: null
				}));
			return [...(options.busy ?? []), ...booked];
		}
	} as unknown as CalendarRepository;

	const service = createReservationsService({
		repo,
		calendar,
		hostOf: async () => ({ name: 'Izi', email: 'me@example.test' }),
		notify: async (hostUserId, booking, kind) => {
			if (options.notifyFails) throw new Error('provider down');
			notified.push({ hostUserId, booking, kind });
		},
		now: () => NOW
	});
	return { service, pages, bookings, notified, deletedEvents };
}

async function withPage(options: SetupOptions = {}) {
	const state = setup(options);
	const outcome = await state.service.create('owner', body);
	assert.equal(outcome.type, 'ok');
	return state;
}

const guest = { name: 'Ana', email: 'ana@example.com', note: 'Hi', start: '2026-09-28T02:00:00.000Z' };

describe('ReservationsService pages', () => {
	test('a blank slug is derived from the title with a random suffix', async () => {
		const { service } = setup();
		const outcome = await service.create('owner', { ...body, slug: '' });
		assert.equal(outcome.type, 'ok');
		assert.match(outcome.type === 'ok' ? outcome.page.slug : '', /^office-hours-[a-z0-9]{5}$/);
	});

	test('a taken slug is reported, not thrown', async () => {
		const { service } = await withPage();
		assert.deepEqual(await service.create('someone-else', body), { type: 'duplicate_slug' });
	});

	test('editing with a blank slug keeps the existing link', async () => {
		const { service, pages } = await withPage();
		const outcome = await service.update('owner', pages[0].id, { ...body, slug: '', title: 'Renamed' });
		assert.equal(outcome.type === 'ok' && outcome.page.slug, 'office-hours');
		assert.equal(outcome.type === 'ok' && outcome.page.title, 'Renamed');
	});

	test('another user can’t edit or delete a page', async () => {
		const { service, pages } = await withPage();
		assert.deepEqual(await service.update('intruder', pages[0].id, body), { type: 'not_found' });
		assert.equal(await service.remove('intruder', pages[0].id), false);
	});

	test('a paused page is invisible publicly', async () => {
		const { service, pages } = await withPage();
		assert.equal((await service.publicPage('office-hours'))?.host, 'Izi');
		await service.update('owner', pages[0].id, { ...body, active: false });
		assert.equal(await service.publicPage('office-hours'), null);
		assert.equal(await service.slots('office-hours', null), null);
	});
});

describe('ReservationsService slots and booking', () => {
	test('slots start at the page’s first day and hide busy time', async () => {
		const busy: CalendarEvent = {
			id: 'e',
			title: 'Private',
			start: '2026-09-28T02:00:00.000Z',
			end: '2026-09-28T03:00:00.000Z',
			allDay: false,
			location: null,
			notes: null,
			source: 'feed',
			busy: true,
			calendar: null
		};
		const free: CalendarEvent = { ...busy, id: 'f', start: '2026-09-28T03:00:00.000Z', end: '2026-09-28T04:00:00.000Z', busy: false };
		const { service } = await withPage({ busy: [busy, free] });
		const days = await service.slots('office-hours', null);
		assert.equal(days?.[0].date, '2026-09-28');
		assert.deepEqual(days?.[0].slots, ['2026-09-28T03:00:00.000Z', '2026-09-28T04:00:00.000Z']);
	});

	test('a from date before today is clamped', async () => {
		const { service } = await withPage();
		const days = await service.slots('office-hours', '2020-01-01');
		assert.equal(days?.[0].date, '2026-09-28');
	});

	test('booking a free slot stores it, notifies, and then blocks it', async () => {
		const { service, bookings, notified } = await withPage();
		assert.deepEqual(await service.book('office-hours', guest), {
			type: 'ok',
			start: '2026-09-28T02:00:00.000Z',
			end: '2026-09-28T03:00:00.000Z'
		});
		assert.equal(bookings[0].eventTitle, 'Ana · Office hours');
		assert.match(bookings[0].eventNotes, /ana@example.com/);
		assert.equal(notified[0].hostUserId, 'owner');
		assert.equal(notified[0].booking.guestEmail, 'ana@example.com');

		assert.deepEqual(await service.book('office-hours', { ...guest, email: 'bo@example.com' }), { type: 'slot_taken' });
	});

	test('a time that isn’t a slot start is refused', async () => {
		const { service } = await withPage();
		assert.deepEqual(await service.book('office-hours', { ...guest, start: '2026-09-28T02:30:00.000Z' }), {
			type: 'slot_taken'
		});
		assert.deepEqual(await service.book('office-hours', { ...guest, start: 'soon' }), { type: 'slot_taken' });
	});

	test('guest details are validated before anything is stored', async () => {
		const { service, bookings } = await withPage();
		assert.deepEqual(await service.book('office-hours', { ...guest, email: 'nope' }), { type: 'invalid_email' });
		assert.deepEqual(await service.book('office-hours', { ...guest, name: '' }), { type: 'invalid_name' });
		assert.equal(bookings.length, 0);
	});

	test('one guest address can only hold a few upcoming bookings', async () => {
		const { service } = await withPage();
		const starts = ['2026-09-28T02:00:00.000Z', '2026-09-28T03:00:00.000Z', '2026-09-28T04:00:00.000Z', '2026-09-29T02:00:00.000Z'];
		const outcomes = [];
		for (const start of starts) outcomes.push((await service.book('office-hours', { ...guest, start })).type);
		assert.equal(outcomes.filter((type) => type === 'ok').length, MAX_UPCOMING_PER_GUEST);
		assert.equal(outcomes.at(-1), 'too_many');
	});

	test('cancelling a booking removes it, frees the slot and sends a cancellation for the same event', async () => {
		const { service, bookings, notified, deletedEvents } = await withPage();
		assert.equal((await service.book('office-hours', guest)).type, 'ok');
		const eventId = bookings[0].eventId;

		assert.equal(await service.cancelBooking('owner', eventId), true);
		assert.deepEqual(deletedEvents, [eventId]);
		assert.deepEqual(
			notified.map((entry) => entry.kind),
			['request', 'cancel']
		);
		assert.equal(notified[1].booking.uid, notified[0].booking.uid);
		assert.equal(notified[1].booking.guestEmail, 'ana@example.com');
		assert.equal(notified[1].booking.pageTitle, 'Office hours');
		assert.equal((await service.book('office-hours', { ...guest, email: 'bo@example.com' })).type, 'ok');
	});

	test('cancelling something that isn’t a booking sends nothing', async () => {
		const { service, notified } = await withPage();
		assert.equal(await service.cancelBooking('owner', 'no-such-event'), false);
		assert.equal(notified.length, 0);
	});

	test('a failed cancellation email still cancels', async () => {
		const { service, bookings } = await withPage({ notifyFails: true });
		await service.book('office-hours', guest);
		assert.equal(await service.cancelBooking('owner', bookings[0].eventId), true);
		assert.equal(bookings.length, 0);
	});

	test('a failed notification never undoes the booking', async () => {
		const { service, bookings } = await withPage({ notifyFails: true });
		assert.equal((await service.book('office-hours', guest)).type, 'ok');
		assert.equal(bookings.length, 1);
	});
});
