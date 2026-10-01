import type { LayoutServerLoad } from './$types';
import { getApiTokenService } from '$lib/server/api-tokens';
import { getAuthService } from '$lib/server/auth';
import { readVapidConfiguration } from '$lib/server/push-notifications';
import { DEFAULT_CLEANUP_SETTINGS, getCleanupSettings } from '$lib/server/cleanup';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const db = platform?.env.DB;
	const auth = db ? getAuthService(platform) : null;
	const signature = locals.user && auth ? await auth.getEmailSignature(locals.user.id) : '';
	const apiTokens =
		locals.user && db ? await getApiTokenService(platform).listApiTokens(locals.user.id) : [];
	const vapid = platform?.env ? readVapidConfiguration(platform.env) : null;
	const twoFactor =
		locals.user && auth
			? await auth.getTwoFactorStatus(locals.user.id)
			: { enabled: false, enabledAt: null, backupCodesRemaining: 0 };
	const recovery =
		locals.user && auth
			? await auth.getRecoveryStatus(locals.user.id)
			: { email: null, pending: null, verifiedAt: null };
	const cleanup =
		locals.user && db
			? await getCleanupSettings(db, locals.user.id)
			: DEFAULT_CLEANUP_SETTINGS;

	return {
		domains: locals.domains,
		addresses: locals.addresses,
		signature,
		apiTokens,
		push: {
			configured: Boolean(vapid),
			publicKey: vapid?.publicKey ?? null
		},
		twoFactor,
		recovery,
		cleanup,
		isAdmin: locals.user?.is_admin ?? false
	};
};
