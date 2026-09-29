/**
 * Why a camera or microphone didn't start, as an i18n key. Browsers report the
 * reason in the error's `name` (a DOMException from getUserMedia, passed through
 * by LiveKit); each one has a different fix, so each gets its own message.
 */
const REASONS: Record<string, string> = {
	// The site's permission is set to block — the browser won't even ask.
	NotAllowedError: 'meet.deviceErrorBlocked',
	PermissionDeniedError: 'meet.deviceErrorBlocked',
	SecurityError: 'meet.deviceErrorBlocked',
	// The device exists but couldn't be opened: another app, or a driver problem.
	NotReadableError: 'meet.deviceErrorBusy',
	TrackStartError: 'meet.deviceErrorBusy',
	AbortError: 'meet.deviceErrorBusy',
	NotFoundError: 'meet.deviceErrorMissing',
	DevicesNotFoundError: 'meet.deviceErrorMissing',
	// A device picked earlier isn't there any more.
	OverconstrainedError: 'meet.deviceErrorUnavailable',
	ConstraintNotSatisfiedError: 'meet.deviceErrorUnavailable'
};

export function deviceErrorKey(error: unknown): string {
	// Browsers only offer cameras and microphones to secure pages.
	if (globalThis.isSecureContext === false) return 'meet.deviceErrorInsecure';
	const name = error instanceof Error || error instanceof DOMException ? error.name : '';
	return Object.hasOwn(REASONS, name) ? REASONS[name] : 'meet.deviceError';
}
