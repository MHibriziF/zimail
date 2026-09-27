<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import Logo from '$lib/components/Logo.svelte';
	import { t } from '$lib/i18n';
	import { APP_NAME } from '$lib/constants';
	import { discardPushSubscriptionFromAnotherAccount } from '$lib/push-client';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let needsCode = $state(false);
	let code = $state('');
	let loading = $state(false);

	// After a client-side redirect from an ended session, the root layout still holds the old account.
	onMount(() => {
		if (get(page).data.user) invalidateAll();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		loading = true;

		try {
			const res = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password, code: needsCode ? code : undefined })
			});
			const data = await res.json();
			if (!res.ok) {
				// The password was right — the form just grows a second field.
				if (data.requiresTwoFactor) {
					needsCode = true;
					code = '';
					error = data.error ?? '';
					return;
				}
				error = data.error ?? 'Login failed';
				return;
			}
			try {
				await discardPushSubscriptionFromAnotherAccount();
			} catch (pushError) {
				console.warn('Could not reconcile the existing push subscription after login', pushError);
			}
			window.location.href = '/inbox';
		} catch {
			error = t('common.networkError');
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>{t('auth.signInTitle', { app: APP_NAME })}</title>
</svelte:head>

<div class="auth-shell">
	<div class="auth-card">
		<div class="auth-brand">
			<div class="brand-icon"><Logo size={48} /></div>
			<h1>{t('auth.signIn')}</h1>
		</div>

		<form class="mt-8 space-y-4" onsubmit={submit}>
			<div>
				<label for="email" class="text-sm text-[var(--color-text-secondary)]">{t('auth.email')}</label>
				<input id="email" type="email" bind:value={email} required autocomplete="username" class="auth-input" />
			</div>
			<div>
				<label for="password" class="text-sm text-[var(--color-text-secondary)]">{t('auth.password')}</label>
				<input
					id="password"
					type="password"
					bind:value={password}
					required
					autocomplete="current-password"
					class="auth-input"
				/>
			</div>

			{#if needsCode}
				<div>
					<label for="code" class="text-sm text-[var(--color-text-secondary)]">
						{t('auth.twoFactorLabel')}
					</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="code"
						type="text"
						bind:value={code}
						required
						autofocus
						inputmode="numeric"
						autocomplete="one-time-code"
						placeholder="123456"
						class="auth-input"
					/>
					<p class="hint">{t('auth.recoveryHint')}</p>
				</div>
			{/if}

			{#if error}
				<p class="text-sm text-[var(--color-text-secondary)]">{error}</p>
			{/if}

			<button type="submit" disabled={loading} class="btn-primary mt-2 w-full py-2.5">
				{loading ? t('auth.signingIn') : needsCode ? t('auth.verify') : t('common.continue')}
			</button>
		</form>

		{#if !needsCode}
			<a href="/forgot" class="forgot">{t('auth.forgotPassword')}</a>
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

	.forgot {
		display: block;
		margin-top: 1.25rem;
		font-size: 0.8125rem;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.forgot:hover {
		color: var(--color-text);
	}

	.hint {
		margin-top: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.brand-icon {
		display: flex;
		margin-bottom: 1rem;
		/* Matches the mark's own corner radius so the shadow hugs the tile. */
		border-radius: 0.75rem;
		box-shadow: var(--shadow-sm);
	}
</style>
