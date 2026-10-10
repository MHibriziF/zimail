import { t } from '$lib/i18n';

const MESSAGE_KEYS: Record<string, string> = {
	reserved_address: 'domains.reservedAddress',
	catchall_address: 'domains.catchallAddress'
};

/** The message to show when `POST /api/addresses` refuses an address. */
export function addressErrorMessage(
	body: { error?: string; code?: string | null },
	address: string,
	fallback: string
): string {
	const key = body.code ? MESSAGE_KEYS[body.code] : undefined;
	if (key) return t(key, { address });
	return body.error ?? fallback;
}
