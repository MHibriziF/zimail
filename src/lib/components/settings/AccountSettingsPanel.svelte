<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { MAX_USER_NAME_LENGTH, MIN_PASSWORD_LENGTH } from '$lib/constants';

	let { name: initialName, email }: { name: string; email: string } = $props();

	let accountName = $state(untrack(() => initialName));
	let accountBusy = $state(false);
	let accountError = $state('');
	let accountSaved = $state(false);

	async function saveAccountName(event: SubmitEvent) {
		event.preventDefault();
		accountBusy = true;
		accountError = '';
		accountSaved = false;

		try {
			const res = await fetch('/api/settings/account', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: accountName })
			});
			const body = await res.json();
			if (!res.ok) {
				accountError = body.error ?? 'Could not save your name';
				return;
			}

			accountName = body.user.name;
			accountSaved = true;
			// The sidebar and header read the name from layout data.
			await invalidateAll();
		} catch {
			accountError = t('common.networkError');
		} finally {
			accountBusy = false;
		}
	}

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let passwordBusy = $state(false);
	let passwordError = $state('');
	let passwordSaved = $state(false);

	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		passwordError = '';
		passwordSaved = false;

		if (newPassword !== confirmPassword) {
			passwordError = t('settings.passwordsDoNotMatch');
			return;
		}
		if (newPassword.length < MIN_PASSWORD_LENGTH) {
			passwordError = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
			return;
		}

		passwordBusy = true;

		try {
			const res = await fetch('/api/settings/account', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			const body = await res.json();
			if (!res.ok) {
				passwordError = body.error ?? 'Could not change your password';
				return;
			}

			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			passwordSaved = true;
			// Rotation revoked the old API keys, so drop them from the list.
			await invalidateAll();
		} catch {
			passwordError = t('common.networkError');
		} finally {
			passwordBusy = false;
		}
	}
</script>

<section class="surface-lg card">
	<h2><Icon name="user-line" size={18} /> Account</h2>
	<p class="card-hint">
		Signed in as {email}. This is your login identity — mailboxes have their own display names.
	</p>

	<form class="account-form" onsubmit={saveAccountName}>
		<label class="field-title" for="account-name">{t('settings.displayName')}</label>
		<input
			id="account-name"
			class="text-input"
			type="text"
			bind:value={accountName}
			maxlength={MAX_USER_NAME_LENGTH}
			autocomplete="name"
			required
		/>

		<div class="account-actions">
			<button type="submit" class="btn-primary" disabled={accountBusy}>
				{accountBusy ? t('common.saving') : t('settings.saveName')}
			</button>
		</div>

		{#if accountError}<p class="error">{accountError}</p>{/if}
		{#if accountSaved}<p class="saved">{t('common.saved')}</p>{/if}
	</form>

	<form class="account-form" onsubmit={changePassword}>
		<label class="field-title" for="current-password">{t('settings.currentPassword')}</label>
		<input
			id="current-password"
			class="text-input"
			type="password"
			bind:value={currentPassword}
			autocomplete="current-password"
			required
		/>

		<label class="field-title" for="new-password">{t('settings.newPassword')}</label>
		<input
			id="new-password"
			class="text-input"
			type="password"
			bind:value={newPassword}
			minlength={MIN_PASSWORD_LENGTH}
			autocomplete="new-password"
			required
		/>

		<label class="field-title" for="confirm-password">{t('settings.confirmNewPassword')}</label>
		<input
			id="confirm-password"
			class="text-input"
			type="password"
			bind:value={confirmPassword}
			minlength={MIN_PASSWORD_LENGTH}
			autocomplete="new-password"
			required
		/>

		<div class="account-actions">
			<span class="card-hint">{t('settings.signsOutDevices')}</span>
			<button type="submit" class="btn-primary" disabled={passwordBusy}>
				{passwordBusy ? t('settings.changing') : t('settings.changePassword')}
			</button>
		</div>

		{#if passwordError}<p class="error">{passwordError}</p>{/if}
		{#if passwordSaved}<p class="saved">{t('settings.passwordChanged')}</p>{/if}
	</form>
</section>

<style>
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

	.field-title {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.text-input {
		width: 100%;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		transition: box-shadow 0.15s;
	}

	.text-input::placeholder {
		color: var(--color-muted);
	}

	.text-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.saved {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--tone-good-fg);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.account-form {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.account-form + .account-form {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--color-line);
	}

	.account-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.account-actions .card-hint {
		margin: 0;
		margin-right: auto;
	}

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}
</style>
