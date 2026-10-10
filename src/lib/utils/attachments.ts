export function isImageType(contentType: string): boolean {
	return contentType.startsWith('image/');
}

/**
 * The only types a stored file may be served inline as, mapped to the exact
 * Content-Type sent. Senders declare the type themselves, so anything a browser
 * could run as a page (HTML, SVG, XML) is served as a download instead.
 */
const INLINE_CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
	['image/png', 'image/png'],
	['image/jpeg', 'image/jpeg'],
	['image/gif', 'image/gif'],
	['image/webp', 'image/webp'],
	['application/pdf', 'application/pdf'],
	['text/plain', 'text/plain; charset=utf-8']
]);

/** Lower-cased media type with any parameters (`; charset=...`) removed. */
export function baseContentType(contentType: string): string {
	return contentType.split(';')[0].trim().toLowerCase();
}

/** The Content-Type to serve a file inline with, or null when it must be downloaded. */
export function inlineContentType(contentType: string): string | null {
	return INLINE_CONTENT_TYPES.get(baseContentType(contentType)) ?? null;
}

export function isPreviewableInline(contentType: string): boolean {
	return inlineContentType(contentType) !== null;
}

/** An image the server serves inline, so an `<img>` pointing at it renders. */
export function isInlineImageType(contentType: string): boolean {
	return isPreviewableInline(contentType) && baseContentType(contentType).startsWith('image/');
}

/** An iCalendar part: an invitation, a cancellation, or an answer to one. */
export function isCalendarAttachment(contentType: string, filename = ''): boolean {
	const type = contentType.toLowerCase();
	return type.startsWith('text/calendar') || type.startsWith('application/ics') || filename.toLowerCase().endsWith('.ics');
}

export function attachmentHref(emailId: string, attachmentId: string, download = false): string {
	const base = `/api/mail/${emailId}/attachments/${attachmentId}`;
	return download ? `${base}?download=1` : base;
}

export function attachmentIcon(contentType: string): string {
	if (isImageType(contentType)) return 'image-line';
	if (contentType === 'application/pdf') return 'file-pdf-line';
	if (contentType.startsWith('text/')) return 'file-text-line';
	if (contentType.includes('zip') || contentType.includes('compressed')) return 'file-zip-line';
	return 'file-3-line';
}
