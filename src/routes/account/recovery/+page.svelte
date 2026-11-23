<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { t } from '$lib/i18n';
	import { APP_NAME } from '$lib/constants';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Recovery address — {APP_NAME}</title></svelte:head>

<div class="auth-shell">
	<div class="auth-card">
		<div class="auth-brand">
			<div class="brand-icon"><Logo size={48} /></div>
			<h1>{data.confirmed ? 'Recovery address confirmed' : 'Link no longer valid'}</h1>
		</div>

		<p class="note">
			{#if data.confirmed}
				{data.email} can now be used to reset your password.
			{:else}
				That link has expired or already been used. Ask for a new one from Settings.
			{/if}
		</p>

		<a href="/settings" class="btn-primary block-link">{t('auth.backToSettings')}</a>
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
