<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import StackHeader from '../StackHeader.svelte';
	import AccountSettingsPanel from './AccountSettingsPanel.svelte';
	import AppearanceThemePanel from './AppearanceThemePanel.svelte';
	import SignaturePanel from './SignaturePanel.svelte';
	import AddressesPanel from './AddressesPanel.svelte';
	import ConnectedDomainsPanel from './ConnectedDomainsPanel.svelte';
	import ApiKeysPanel from './ApiKeysPanel.svelte';
	import DesktopNotifications from './DesktopNotifications.svelte';
	import TwoFactorPanel from './TwoFactorPanel.svelte';
	import RecoveryEmailPanel from './RecoveryEmailPanel.svelte';
	import CleanupPanel from './CleanupPanel.svelte';
	import TimeZonePanel from './TimeZonePanel.svelte';
	import InstallApp from './InstallApp.svelte';
	import LocalePicker from './LocalePicker.svelte';
	import UiThemePicker from './UiThemePicker.svelte';
	import { APP_NAME } from '$lib/constants';
	import type { SettingsSection } from '$lib/settings-section';
	import type { LayoutData } from '../../../routes/settings/$types';

	/**
	 * Classic shows the whole page; Zero shows one pane at a time, chosen by
	 * its sidebar. Same content either way — only how much of it is on screen.
	 */
	let { data, section = 'all' }: { data: LayoutData; section?: SettingsSection } = $props();

	const show = $derived((name: SettingsSection) => section === 'all' || section === name);
</script>

<svelte:head>
	<title>Settings — {APP_NAME}</title>
</svelte:head>

<div class="settings-page">
	<StackHeader title={t('nav.settings')} back={false} />

	{#if show('general')}
		<AccountSettingsPanel name={data.user?.name ?? ''} email={data.user?.email ?? ''} />
	{/if}

	{#if show('security')}
		<TwoFactorPanel
			enabled={data.twoFactor.enabled}
			backupCodesRemaining={data.twoFactor.backupCodesRemaining}
		/>
	{/if}

	{#if show('security')}
		<RecoveryEmailPanel email={data.recovery.email} pending={data.recovery.pending} />
	{/if}

	{#if show('general')}
		<TimeZonePanel timeZone={data.timeZone} />
	{/if}

	{#if show('cleanup')}
		<CleanupPanel retentionDays={data.cleanup.trashRetentionDays} />
	{/if}

	{#if show('appearance')}
		<section class="surface-lg card">
			<h2><Icon name="layout-4-line" size={18} /> Interface</h2>
			<p class="card-hint">{t('settings.interfaceHint')}</p>
			<UiThemePicker />
		</section>
	{/if}

	{#if show('appearance')}
		<section class="surface-lg card">
			<h2><Icon name="translate-2" size={18} /> Language</h2>
			<p class="card-hint">{t('settings.languageAccountHint')}</p>
			<LocalePicker />
		</section>
	{/if}

	{#if show('appearance')}
		<AppearanceThemePanel />
	{/if}

	{#if show('appearance')}
		<InstallApp />
	{/if}

	{#if show('notifications')}
		<DesktopNotifications configured={data.push.configured} publicKey={data.push.publicKey} />
	{/if}

	{#if show('general')}
		<SignaturePanel signature={data.signature} />
	{/if}

	{#if show('connections')}
		<AddressesPanel addresses={data.addresses} domains={data.domains} />
	{/if}

	{#if show('connections')}
		<ConnectedDomainsPanel domains={data.domains} />
	{/if}

	{#if show('connections')}
		<ApiKeysPanel tokens={data.apiTokens} isAdmin={data.isAdmin} />
	{/if}
</div>

<style>
	.settings-page {
		max-width: 42rem;
	}

	.settings-page :global(.stack-header) {
		margin-bottom: 0;
	}

	.card {
		margin-top: 1.5rem;
		padding: 1.5rem;
	}

	.card h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.card-hint {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	@media (max-width: 900px) {
		.settings-page {
			max-width: none;
			padding-bottom: 1.5rem;
		}

		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}
</style>
