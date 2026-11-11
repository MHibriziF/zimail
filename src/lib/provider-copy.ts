import { t } from '$lib/i18n';
import type { EmailProviderKind } from '$lib/types';

/** Setup and onboarding text for each mail provider, from `provider.*` in `messages/*.json`. */

export function providerName(kind: EmailProviderKind): string {
	return t(`provider.${kind}`);
}

export function missingProviderTitle(kind: EmailProviderKind): string {
	return t(`provider.missingTitle.${kind}`);
}

export function missingProviderHint(kind: EmailProviderKind): string {
	return t(`provider.missingHint.${kind}`);
}

export function noDomainsTitle(kind: EmailProviderKind): string {
	return t(`provider.noDomainsTitle.${kind}`);
}

export function noDomainsBody(kind: EmailProviderKind): string {
	return t(`provider.noDomainsBody.${kind}`);
}

export function domainPickerSubtitle(kind: EmailProviderKind): string {
	return t(`provider.domainPickerSubtitle.${kind}`);
}

export function onboardingSubtitle(kind: EmailProviderKind): string {
	return t(`provider.onboardingSubtitle.${kind}`);
}

export function receivingHint(kind: EmailProviderKind, domainName: string): string {
	return t(`provider.receivingHint.${kind}`, { domain: domainName });
}
