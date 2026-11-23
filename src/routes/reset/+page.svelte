<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import Logo from '$lib/components/Logo.svelte';
	import { APP_NAME, MIN_PASSWORD_LENGTH } from '$lib/constants';

	const token = $derived(page.url.searchParams.get('token') ?? '');

	let password = $state('');
	let confirm = $state('');
	let error = $state('');
	let done = $state(false);
	let loading = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		if (password !== confirm) {
			error = t('auth.passwordsDoNotMatch');
			return;
		}
		if (password.length < MIN_PASSWORD_LENGTH) {
			error = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
			return;
		}

		loading = true;
		try {
			const res = await fetch('/api/auth/reset', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, password })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not reset your password';
				return;
			}
			done = true;
		} catch {
			error = t('auth.networkTryAgain');
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>{t('auth.resetTitle')} — {APP_NAME}</title></svelte:head>

<div class="auth-shell">
	<div class="auth-card">
		<div class="auth-brand">
			<div class="brand-icon"><Logo size={48} /></div>
			<h1>{done ? t('auth.passwordUpdated') : t('auth.resetTitle')}</h1>
		</div>

		{#if done}
			<p class="note">{t('auth.resetDoneHint')}</p>
			<a href="/login" class="btn-primary block-link">{t('auth.goToSignIn')}</a>
		{:else if !token}
			<p class="note">{t('auth.missingToken')}</p>
			<a href="/forgot" class="btn-primary block-link">{t('auth.requestNewLink')}</a>
		{:else}
			<form class="mt-8 space-y-4" onsubmit={submit}>
				<div>
					<label for="password" class="text-sm text-[var(--color-text-secondary)]">
						{t('accountSetup.newPassword')}
					</label>
					<input
						id="password"
						type="password"
						bind:value={password}
						required
						minlength={MIN_PASSWORD_LENGTH}
						autocomplete="new-password"
						class="auth-input"
					/>
				</div>
				<div>
					<label for="confirm" class="text-sm text-[var(--color-text-secondary)]">
						{t('setup.confirmPassword')}
					</label>
					<input
						id="confirm"
						type="password"
						bind:value={confirm}
						required
						minlength={MIN_PASSWORD_LENGTH}
						autocomplete="new-password"
						class="auth-input"
					/>
				</div>

				{#if error}
					<p class="text-sm text-[var(--color-danger)]">{error}</p>
				{/if}

				<button type="submit" disabled={loading} class="btn-primary mt-2 w-full py-2.5">
					{loading ? t('common.saving') : t('auth.setPassword')}
				</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.auth-brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.brand-icon {
		display: flex;
		margin-bottom: 1rem;
		border-radius: calc(0.75rem * var(--radius-scale, 1));
		box-shadow: var(--shadow-sm);
	}

	.note {
		margin-top: 1rem;
		font-size: 0.875rem;
		line-height: 1.5;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.block-link {
		display: flex;
		width: 100%;
		margin-top: 1.5rem;
		padding-top: 0.625rem;
		padding-bottom: 0.625rem;
	}
</style>
