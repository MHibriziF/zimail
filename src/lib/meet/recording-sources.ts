import { colorFor, initialsFor } from './avatar';
import type { CompositeSource } from './composite-recorder';

/** A participant as the meeting recording sees them: who they are and what they are showing. */
export type RecordingParticipant = {
	identity: string;
	name: string;
	/** The camera track while it is on; `null` draws their initials instead. */
	camera: MediaStreamTrack | null;
	screen: MediaStreamTrack | null;
};

export type RecordingLabels = {
	/** "Ada's screen", for the share tile's caption. */
	screenShareOf: (name: string) => string;
};

/**
 * What "Record meeting" draws each frame: everyone's camera (or initials) and
 * any screen share, the share placed before the person showing it.
 */
export function compositeSources(participants: RecordingParticipant[], labels: RecordingLabels): CompositeSource[] {
	return participants.flatMap(({ identity, name, camera, screen }) => {
		const person: CompositeSource = {
			key: identity,
			label: name,
			video: camera,
			screen: false,
			color: colorFor(identity),
			initials: initialsFor(name)
		};
		if (!screen) return [person];
		return [
			{ ...person, key: `${identity}:screen`, label: labels.screenShareOf(name), video: screen, screen: true },
			person
		];
	});
}
