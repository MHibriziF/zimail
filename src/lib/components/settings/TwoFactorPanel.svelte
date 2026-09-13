<script lang="ts">
	import { untrack } from 'svelte';
	import qrcode from 'qrcode-generator';
	import Icon from '$lib/components/Icon.svelte';
	import { formatSecretForDisplay } from '$lib/totp-display';
	import { t } from '$lib/i18n';

	let {
		enabled: initialEnabled,
		backupCodesRemaining: initialRemaining
	}: {
		enabled: boolean;
		backupCodesRemaining: number;
	} = $props();

	// Seeded from the load, then owned locally — the panel updates itself after
	// each action rather than waiting on a round trip.
	let enabled = $state(untrack(() => initialEnabled));
	let remaining = $state(untrack(() => initialRemaining));

	let secret = $state('');
	let uri = $state('');
	let code = $state('');
	let password = $state('');
	let codes = $state<string[]>([]);
	let busy = $state(false);
	let error = $state('');
	let copied = $state(false);

	/** Level M is what authenticator apps expect; the URI is short enough. */
	const qrSvg = $derived.by(() => {
		if (!uri) return '';
		const qr = qrcode(0, 'M');
		qr.addData(uri);
		qr.make();
		return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
	});

	async function call(action: string, extra: Record<string, unknown> = {}) {
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/settings/two-factor', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ...extra })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Something went wrong';
				return null;
			}
			return body;
		} catch {
			error = t('common.networkError');
			return null;
		} finally {
			busy = false;
		}
	}

	async function start() {
		const body = await call('start');
		if (!body) return;
		secret = body.secret;
		uri = body.uri;
		code = '';
	}

	async function confirm(event: SubmitEvent) {
		event.preventDefault();
		const body = await call('confirm', { code });
		if (!body) return;
		codes = body.backupCodes;
		enabled = true;
		remaining = body.backupCodes.length;
		secret = '';
		uri = '';
		code = '';
	}

	async function regenerate(event: SubmitEvent) {
		event.preventDefault();
		const body = await call('regenerate-codes', { password });
		if (!body) return;
		codes = body.backupCodes;
		remaining = body.backupCodes.length;
		password = '';
	}

	// A plain button inside the form, so there is no submit event to cancel.
	async function disable() {
		const body = await call('disable', { password });
		if (!body) return;
		enabled = false;
		remaining = 0;
		codes = [];
		password = '';
	}

	function cancel() {
		secret = '';
		uri = '';
		code = '';
		error = '';
	}

	async function copyCodes() {
		try {
			await navigator.clipboard.writeText(codes.join('\n'));
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard can be blocked; the codes are on screen to copy by hand.
		}
	}
</script>

<section class="surface-lg card">
	<h2><Icon name="shield-keyhole-line" size={18} /> {t('twoFactor.title')}</h2>

	{#if codes.length}
		<!-- Shown once. There is no way to read them back afterwards. -->
		<p class="card-hint">{t('twoFactor.saveCodes')}</p>
		<ul class="codes">
			{#each codes as backup (backup)}
				<li>{backup}</li>
			{/each}
		</ul>
		<div class="actions">
			<button type="button" class="btn-primary" onclick={copyCodes}>
				{copied ? t('common.copied') : t('twoFactor.copyCodes')}
			</button>
			<button type="button" class="btn-ghost" onclick={() => (codes = [])}>
				{t('twoFactor.savedThem')}
			</button>
		</div>
	{:else if uri}
		<p class="card-hint">{t('twoFactor.scanHint')}</p>

		<div class="enroll">
			<div class="qr">{@html qrSvg}</div>
			<div class="manual">
				<p class="manual-label">{t('twoFactor.cannotScan')}</p>
				<code class="secret">{formatSecretForDisplay(secret)}</code>
			</div>
		</div>

		<form class="stack" onsubmit={confirm}>
			<label class="field-title" for="totp-code">{t('twoFactor.codeLabel')}</label>
			<input
				id="totp-code"
				class="text-input"
				bind:value={code}
				inputmode="numeric"
				autocomplete="one-time-code"
				maxlength="7"
				placeholder="123456"
				required
			/>
			<div class="actions">
				<button type="button" class="btn-ghost" onclick={cancel}>{t('common.cancel')}</button>
				<button type="submit" class="btn-primary" disabled={busy}>
					{busy ? t('twoFactor.checking') : t('twoFactor.turnOn')}
				</button>
			</div>
		</form>
	{:else if enabled}
		<p class="card-hint">
			<span class="on-badge">{t('twoFactor.on')}</span>
			{t('twoFactor.enabledHint')}
		</p>

		{#if remaining === 0}
			<p class="warn">{t('twoFactor.noCodesLeft')}</p>
		{:else}
			<p class="card-hint">{t('twoFactor.codesRemaining', { count: remaining })}</p>
		{/if}

		<form class="stack" onsubmit={regenerate}>
			<label class="field-title" for="regen-password">{t('auth.password')}</label>
			<input
				id="regen-password"
				class="text-input"
				type="password"
				bind:value={password}
				autocomplete="current-password"
				required
			/>
			<div class="actions">
				<button type="submit" class="btn-ghost" disabled={busy}>{t('twoFactor.newCodes')}</button>
				<button type="button" class="btn-ghost danger" disabled={busy} onclick={disable}>
					{t('twoFactor.turnOff')}
				</button>
			</div>
		</form>
	{:else}
		<p class="card-hint">{t('twoFactor.setUpHint')}</p>
		<div class="actions">
			<button type="button" class="btn-primary" onclick={start} disabled={busy}>
				{busy ? t('twoFactor.preparing') : t('twoFactor.setUp')}
			</button>
		</div>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
</section>

<style>
	/* `.surface-lg` is global but carries no padding — all of it lives in
	   `.card`, which is scoped per page/component. Same story for the classes
	   below: page- or component-scoped everywhere in this codebase rather than
	   global, so they are redeclared here the way DesktopNotifications does. */
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

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}

	/* .card-hint, .error, .field-title and .text-input are all page- or
	   component-scoped elsewhere in this codebase rather than global, so they
	   are redeclared here the same way AddressField and the setup page do. */
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

	.card-hint {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.danger {
		color: var(--color-danger);
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.75rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.enroll {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1.25rem;
		margin-top: 0.875rem;
	}

	.qr {
		width: 11rem;
		height: 11rem;
		flex-shrink: 0;
		padding: 0.5rem;
		border-radius: 0.75rem;
		/* The pattern must stay dark-on-light in both themes or scanners fail. */
		background: #ffffff;
	}

	.qr :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.manual {
		min-width: 12rem;
		flex: 1;
	}

	.manual-label {
		margin: 0 0 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.secret {
		display: inline-block;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.875rem;
		letter-spacing: 0.05em;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		word-break: break-all;
	}

	.codes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
		gap: 0.375rem;
		margin: 0.875rem 0 0;
		padding: 0.75rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.875rem;
		list-style: none;
	}

	.on-badge {
		display: inline-block;
		margin-right: 0.375rem;
		padding: 0.0625rem 0.4rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--tone-good-fg);
		background: var(--tone-good-bg);
	}

	.warn {
		margin: 0.5rem 0 0;
		font-size: 0.8125rem;
		color: var(--tone-warn-fg);
	}
</style>
