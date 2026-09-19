import type { D1Database } from '@cloudflare/workers-types';

/** Blocked senders (per user) plus the one read of `emails` spam needs. */
export type SpamRepository = {
	isBlocked(userId: string, address: string): Promise<boolean>;
	block(userId: string, addresses: string[]): Promise<void>;
	unblock(userId: string, addresses: string[]): Promise<void>;
	/** Distinct senders of the inbound messages among `emailIds`, lower-cased. */
	inboundSenders(userId: string, emailIds: string[]): Promise<string[]>;
};

export function createD1SpamRepository(db: D1Database): SpamRepository {
	return {
		async isBlocked(userId, address) {
			const row = await db
				.prepare('SELECT 1 AS blocked FROM blocked_senders WHERE user_id = ? AND address = ?')
				.bind(userId, address)
				.first<{ blocked: number }>();
			return Boolean(row);
		},

		async block(userId, addresses) {
			if (addresses.length === 0) return;
			await db.batch(
				addresses.map((address) =>
					db
						.prepare('INSERT OR IGNORE INTO blocked_senders (user_id, address) VALUES (?, ?)')
						.bind(userId, address)
				)
			);
		},

		async unblock(userId, addresses) {
			if (addresses.length === 0) return;
			const placeholders = addresses.map(() => '?').join(', ');
			await db
				.prepare(`DELETE FROM blocked_senders WHERE user_id = ? AND address IN (${placeholders})`)
				.bind(userId, ...addresses)
				.run();
		},

		async inboundSenders(userId, emailIds) {
			if (emailIds.length === 0) return [];
			const placeholders = emailIds.map(() => '?').join(', ');
			const { results } = await db
				.prepare(
					`SELECT DISTINCT lower(from_addr) AS address FROM emails
					 WHERE user_id = ? AND direction = 'inbound' AND id IN (${placeholders})`
				)
				.bind(userId, ...emailIds)
				.all<{ address: string }>();
			return results.map((row) => row.address).filter(Boolean);
		}
	};
}
