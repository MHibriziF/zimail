import type { DeliveryStatus } from '$lib/types';

/**
 * How far a sent message has got. Resend doesn't deliver webhooks in order, so
 * a status only ever moves to a higher rank: a late `email.sent` can't undo
 * `delivered`. The three failures share the top rank, so once one lands
 * nothing replaces it.
 */
const RANK: Record<DeliveryStatus, number> = {
	queued: 0,
	sent: 1,
	delayed: 2,
	delivered: 3,
	bounced: 4,
	complained: 4,
	failed: 4
};

const DELIVERY_STATUSES = Object.keys(RANK) as DeliveryStatus[];

export function canMoveDeliveryStatus(from: DeliveryStatus, to: DeliveryStatus): boolean {
	return RANK[to] > RANK[from];
}

/** The states a message may be in for `to` to replace it. */
export function deliveryStatusesBefore(to: DeliveryStatus): DeliveryStatus[] {
	return DELIVERY_STATUSES.filter((from) => canMoveDeliveryStatus(from, to));
}
