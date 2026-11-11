/**
 * Admissions are the waiting room of a meeting: a guest's request to be let
 * in. They are a part of meetings rather than a peer, so there is no service
 * here. The meetings service applies the rules and checks the meeting's
 * ownership; this module only stores the requests.
 */
export {
	createD1AdmissionsRepository,
	type AdmissionsRepository,
	type AdmissionStatus,
	type PendingAdmission
} from './repository';
