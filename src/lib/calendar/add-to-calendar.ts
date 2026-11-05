/**
 * "Add to calendar" links for people whose mail doesn't turn an invitation
 * into a calendar event by itself. Pure, so the email and the booking page
 * build the same links.
 */
export type CalendarLinkEvent = {
	title: string;
	start: Date;
	end: Date;
	description?: string;
	location?: string;
};

/** Google wants `YYYYMMDDTHHMMSSZ`, in UTC. */
function googleTime(date: Date): string {
	return date.toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarLink(event: CalendarLinkEvent): string {
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: event.title,
		dates: `${googleTime(event.start)}/${googleTime(event.end)}`
	});
	if (event.description) params.set('details', event.description);
	if (event.location) params.set('location', event.location);
	return `https://calendar.google.com/calendar/render?${params}`;
}

/** Microsoft 365, which is what most universities and workplaces run. */
export function outlookCalendarLink(event: CalendarLinkEvent): string {
	const params = new URLSearchParams({
		path: '/calendar/action/compose',
		rru: 'addevent',
		subject: event.title,
		startdt: event.start.toISOString(),
		enddt: event.end.toISOString()
	});
	if (event.description) params.set('body', event.description);
	if (event.location) params.set('location', event.location);
	return `https://outlook.office.com/calendar/0/deeplink/compose?${params}`;
}
