/**
 * The user's calendar as one iCalendar file, for other calendar apps to
 * subscribe to (#170).
 */
import { icsDate, icsDocument, icsText, icsTime } from './write';

export type PublishedEvent = {
	id: string;
	title: string;
	/** UTC instant, or midnight UTC of the first date when `allDay`. */
	start: string;
	end: string;
	allDay: boolean;
	location: string | null;
	notes: string | null;
	busy: boolean;
	meetingUrl: string | null;
};

export type CalendarFileOptions = {
	calendarName: string;
	/** Every event reads "Busy", with no place, notes or link: for sharing availability. */
	busyOnly: boolean;
	busyLabel: string;
	now?: Date;
};

/**
 * Not the UID an invitation for the same event carries: if the user invited
 * their own Gmail, Google would otherwise treat the subscribed copy as that
 * invitation.
 */
export function publishedUid(eventId: string): string {
	return `${eventId}@published.zimail`;
}

function timeLines(event: PublishedEvent): string[] {
	const start = new Date(event.start);
	const end = new Date(event.end);
	return event.allDay
		? [`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(end)}`]
		: [`DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`];
}

function detailLines(event: PublishedEvent): string[] {
	const description = [event.meetingUrl ? `Join the Zimail meeting: ${event.meetingUrl}` : '', event.notes ?? '']
		.filter(Boolean)
		.join('\n\n');
	const location = event.location ?? event.meetingUrl;
	return [
		`SUMMARY:${icsText(event.title)}`,
		...(location ? [`LOCATION:${icsText(location)}`] : []),
		...(event.meetingUrl ? [`URL:${event.meetingUrl}`] : []),
		...(description ? [`DESCRIPTION:${icsText(description)}`] : [])
	];
}

function eventLines(event: PublishedEvent, options: CalendarFileOptions, stamp: string): string[] {
	return [
		'BEGIN:VEVENT',
		`UID:${publishedUid(event.id)}`,
		`DTSTAMP:${stamp}`,
		...timeLines(event),
		...(options.busyOnly ? [`SUMMARY:${icsText(options.busyLabel)}`] : detailLines(event)),
		`TRANSP:${event.busy ? 'OPAQUE' : 'TRANSPARENT'}`,
		'END:VEVENT'
	];
}

export function publishedCalendar(events: PublishedEvent[], options: CalendarFileOptions): string {
	const stamp = icsTime(options.now ?? new Date());
	return icsDocument([
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Zimail//Calendar//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${icsText(options.calendarName)}`,
		// A hint some apps follow; serving an unchanged feed costs one row read.
		'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
		'X-PUBLISHED-TTL:PT1H',
		...events.flatMap((event) => eventLines(event, options, stamp)),
		'END:VCALENDAR'
	]);
}
