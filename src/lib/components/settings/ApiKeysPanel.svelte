<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '../Icon.svelte';
	import Check from '../Check.svelte';
	import { t } from '$lib/i18n';
	import type { ApiTokenSummary } from '$lib/types';

	let {
		tokens: initialTokens,
		isAdmin
	}: { tokens: ApiTokenSummary[]; isAdmin: boolean } = $props();

	let tokens = $state(untrack(() => initialTokens));

	let keyName = $state('');
	let sendScope = $state(true);
	let readScope = $state(true);
	let adminScope = $state(false);
	let keyBusy = $state(false);
	let keyError = $state('');
	let creating = $state(false);
	let revealed = $state<{ summary: ApiTokenSummary; token: string } | null>(null);
	let copied = $state(false);
	let installCopied = $state(false);
	const installCommand =
		'curl -fsSL https://raw.githubusercontent.com/DivinPrince/quickinbox/main/scripts/install.sh | sh';

	const canCreateKey = $derived(
		Boolean(keyName.trim()) && (sendScope || readScope || (isAdmin && adminScope))
	);

	function openCreate() {
		keyName = '';
		sendScope = true;
		readScope = true;
		adminScope = false;
		keyError = '';
		revealed = null;
		copied = false;
		creating = true;
	}

	function closeCreate() {
		creating = false;
		revealed = null;
		copied = false;
		keyError = '';
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (creating && event.key === 'Escape' && !revealed) closeCreate();
	}

	async function createKey(event?: SubmitEvent) {
		if (event) event.preventDefault();
		keyBusy = true;
		keyError = '';
		try {
			const scopes = [];
			if (sendScope) scopes.push('mail:send');
			if (readScope) scopes.push('mail:read');
			if (isAdmin && adminScope) scopes.push('admin');

			const res = await fetch('/api/apikeys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: keyName, scopes })
			});
			const body = await res.json();
			if (!res.ok) {
				keyError = body.error ?? 'Could not create the API key';
				return;
			}
			tokens = [body.tokenMeta, ...tokens.filter((token) => token.id !== body.tokenMeta.id)];
			revealed = { summary: body.tokenMeta, token: body.token };
			copied = false;
			keyName = '';
		} catch {
			keyError = t('common.networkError');
		} finally {
			keyBusy = false;
		}
	}

	async function copyKey() {
		if (!revealed) return;
		try {
			await navigator.clipboard.writeText(revealed.token);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard unavailable — the box is still selectable */
		}
	}

	async function copyInstall() {
		try {
			await navigator.clipboard.writeText(installCommand);
			installCopied = true;
			setTimeout(() => (installCopied = false), 1600);
		} catch {
			/* clipboard unavailable — the command is still selectable */
		}
	}

	async function revokeKey(id: string) {
		if (!confirm('Revoke this key?')) return;
		const res = await fetch(`/api/apikeys/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
			keyError = body.error ?? 'Could not revoke that key';
			return;
		}
		tokens = body.tokens;
	}

	function formatDate(value: string): string {
		return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<section class="surface-lg card">
	<div class="card-head">
		<h2><Icon name="key-2-line" size={18} /> API keys</h2>
		<button type="button" class="btn-primary" onclick={openCreate}>
			<Icon name="add-line" size={15} />
			New
		</button>
	</div>

	{#if tokens.length}
		<ul class="key-list">
			{#each tokens as token (token.id)}
				<li class="key-row">
					<div class="min-w-0 flex-1">
						<p class="key-name">{token.name}</p>
						<p class="key-meta">
							<code>{token.preview}</code>
							<span class="caps">
								{#each token.scopes as scope (scope)}<span class="chip">{scope}</span>{/each}
							</span>
						</p>
					</div>
					<span class="key-created">{formatDate(token.created_at)}</span>
					<button
						type="button"
						class="icon-btn"
						aria-label={t('settings.revokeKey', { name: token.name })}
						onclick={() => revokeKey(token.id)}
					>
						<Icon name="delete-bin-line" size={15} />
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">{t('settings.noKeys')}</p>
	{/if}

	{#if keyError && !creating}<p class="error">{keyError}</p>{/if}

	<div class="install-row">
		<code>{installCommand}</code>
		<button type="button" class="icon-btn" aria-label={t('settings.copyInstall')} onclick={copyInstall}>
			<Icon name={installCopied ? 'check-line' : 'file-copy-line'} size={15} />
		</button>
	</div>
</section>

{#if creating}
	<div
		class="modal-backdrop"
		role="presentation"
		onclick={(event) => {
			if (event.target === event.currentTarget && !revealed) closeCreate();
		}}
	>
		<div
			class="key-modal"
			role="dialog"
			aria-modal="true"
			aria-label={revealed ? t('settings.copyApiKey') : t('settings.newApiKey')}
			tabindex="-1"
		>
			<div class="modal-head">
				<h3>
					<Icon name="key-2-line" size={16} />
					{revealed ? t('settings.copyThisKey') : t('settings.newApiKey')}
				</h3>
				<button type="button" class="icon-btn" aria-label={t('common.close')} onclick={closeCreate}>
					<Icon name="close-line" size={16} />
				</button>
			</div>

			{#if revealed}
				<p class="modal-note">{t('settings.shownOnce')}</p>
				<pre class="token-box">{revealed.token}</pre>
				<div class="modal-actions">
					<button type="button" class="btn-primary" onclick={copyKey}>
						<Icon name={copied ? 'check-line' : 'file-copy-line'} size={15} />
						{copied ? t('common.copied') : t('common.copy')}
					</button>
					<button type="button" class="btn-ghost" onclick={closeCreate}>{t('common.done')}</button>
				</div>
			{:else}
				<form class="key-form" onsubmit={createKey}>
					<label class="sr-only" for="apikey-name">{t('settings.keyName')}</label>
					<input
						id="apikey-name"
						class="text-input"
						placeholder={t('settings.namePlaceholder')}
						value={keyName}
						autofocus
						oninput={(event) => (keyName = event.currentTarget.value)}
					/>

					<div class="scope-row">
						<Check label={t('settings.sendMail')} caption="send" checked={sendScope} onchange={(next) => (sendScope = next)} />
						<Check label={t('settings.readMail')} caption="read" checked={readScope} onchange={(next) => (readScope = next)} />
						{#if isAdmin}
							<Check
								label={t('nav.admin')}
								caption="admin"
								checked={adminScope}
								onchange={(next) => (adminScope = next)}
							/>
						{/if}
					</div>

					{#if keyError}<p class="error">{keyError}</p>{/if}

					<div class="modal-actions">
						<button type="button" class="btn-ghost" onclick={closeCreate}>{t('common.cancel')}</button>
						<button type="submit" class="btn-primary" disabled={keyBusy || !canCreateKey}>
							{keyBusy ? t('common.creating') : t('common.create')}
						</button>
					</div>
				</form>
			{/if}
		</div>
	</div>
{/if}

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

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.empty {
		margin-top: 1rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.caps {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.chip {
		padding: 0.0625rem 0.4375rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		color: var(--color-muted);
		background: var(--color-surface-muted);
	}

	.key-list {
		margin-top: 1rem;
	}

	.key-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.75rem 0;
	}

	.key-row + .key-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.key-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.key-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.1875rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.key-meta code {
		font-size: 0.75rem;
	}

	.key-created {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: var(--color-scrim);
	}

	.key-modal {
		width: 100%;
		max-width: 26rem;
		padding: 1.25rem 1.375rem 1.375rem;
		border-radius: 1.25rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.modal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.modal-head h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
	}

	.modal-note {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.token-box {
		overflow-x: auto;
		margin-top: 0.875rem;
		padding: 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		word-break: break-all;
		white-space: pre-wrap;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	.key-form .modal-actions {
		margin-top: 0.25rem;
	}

	.key-form {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		margin-top: 1rem;
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

	.scope-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.install-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		padding: 0.625rem 0.75rem;
		border-radius: 0.625rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.install-row code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		font-size: 0.75rem;
		white-space: nowrap;
	}

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}
</style>
