/**
 * What a participant is recording, as carried by their `recording` attribute.
 * Attributes are self-editable, so this is a consent notice for everyone
 * else, never a permission.
 */
export type RecordingKind = 'meeting' | 'view';

export function parseRecordingAttribute(value: string | undefined): RecordingKind | null {
	if (value === 'meeting') return 'meeting';
	// '1' is what the first version of recording set; it only ever meant the recorder's own view.
	if (value === 'view' || value === '1') return 'view';
	return null;
}

/** Which recording choices a participant gets: the whole meeting is the host's; their own view is anyone's. */
export function recordingChoices(options: {
	isHost: boolean;
	meetingSupported: boolean;
	viewSupported: boolean;
}): RecordingKind[] {
	const choices: RecordingKind[] = [];
	if (options.isHost && options.meetingSupported) choices.push('meeting');
	if (options.viewSupported) choices.push('view');
	return choices;
}
