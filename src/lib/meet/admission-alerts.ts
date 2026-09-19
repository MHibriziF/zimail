/**
 * The admissions list is re-polled every few seconds and returns every request
 * still waiting, so "is there someone new?" means "is there an id we haven't
 * rung for yet?" — not "did the list grow?", which misses one request being
 * answered in the same tick another arrives.
 */
export function takeUnseenAdmissions<T extends { id: string }>(seen: Set<string>, pending: readonly T[]): T[] {
	const unseen = pending.filter((admission) => !seen.has(admission.id));
	for (const admission of unseen) seen.add(admission.id);
	return unseen;
}
