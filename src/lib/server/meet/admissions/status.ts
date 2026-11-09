/**
 * A guest's request to join: the host decides once, and an admission is spent
 * by the token it hands out. Without `joined`, the admission id would keep
 * minting tokens for as long as anyone polled it.
 */
export type AdmissionStatus = 'pending' | 'admitted' | 'denied' | 'joined';

const MOVES: Record<AdmissionStatus, readonly AdmissionStatus[]> = {
	pending: ['admitted', 'denied'],
	admitted: ['joined'],
	denied: [],
	joined: []
};

const ADMISSION_STATUSES = Object.keys(MOVES) as AdmissionStatus[];

export function canMoveAdmission(from: AdmissionStatus, to: AdmissionStatus): boolean {
	return MOVES[from].includes(to);
}

/** The states an admission may be in for `to` to replace it. */
export function admissionStatusesBefore(to: AdmissionStatus): AdmissionStatus[] {
	return ADMISSION_STATUSES.filter((from) => canMoveAdmission(from, to));
}
