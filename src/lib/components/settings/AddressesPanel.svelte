<script lang="ts">
	import Icon from '../Icon.svelte';
	import AddressField from '../AddressField.svelte';
	import { t } from '$lib/i18n';
	import { MAX_EMAIL_SIGNATURE_LENGTH } from '$lib/email-signature';
	import type { Domain, MailAddress } from '$lib/types';

	let {
		addresses: initialAddresses,
		domains
	}: { addresses: MailAddress[]; domains: Domain[] } = $props();

	// Server data until an edit happens, then whatever the API returned.
	let edited = $state<MailAddress[] | null>(null);
	const addresses = $derived(edited ?? initialAddresses);

	let localPart = $state('');
	let displayName = $state('');
	let domainId = $state('');
	let error = $state('');
	let busy = $state(false);
	let savingId = $state('');

	$effect(() => {
		if (!domainId && domains[0]) {
			domainId = domains[0].id;
		}
	});

	const selectedDomain = $derived(domains.find((domain) => domain.id === domainId));

	async function addAddress(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';

		try {
			const res = await fetch('/api/addresses', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ domainId, localPart, label: displayName.trim() || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not add that address';
				return;
			}
			edited = [...addresses, body.address];
			localPart = '';
			displayName = '';
		} catch {
			error = t('common.networkError');
		} finally {
			busy = false;
		}
	}

	async function saveLabel(id: string, label: string) {
		const current = addresses.find((address) => address.id === id);
		if (!current || (current.label ?? '') === label.trim()) return;

		savingId = id;
		error = '';
		try {
			const res = await fetch(`/api/addresses/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: label.trim() || null })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not save that name';
				return;
			}
			edited = body.addresses;
		} catch {
			error = t('common.networkError');
		} finally {
			savingId = '';
		}
	}

	async function makeDefault(id: string) {
		const res = await fetch(`/api/addresses/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isDefault: true })
		});
		const body = await res.json();
		if (res.ok) edited = body.addresses;
	}

	async function saveMailboxSignature(id: string, value: string) {
		const current = addresses.find((address) => address.id === id);
		if (!current || (current.signature ?? '') === value.trim()) return;

		savingId = id;
		error = '';
		try {
			const res = await fetch(`/api/addresses/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signature: value })
			});
			const body = await res.json();
			if (!res.ok) {
				error = body.error ?? 'Could not save that signature';
				return;
			}
			edited = body.addresses;
		} catch {
			error = t('common.networkError');
		} finally {
			savingId = '';
		}
	}

	async function remove(id: string) {
		const res = await fetch(`/api/addresses/${id}`, { method: 'DELETE' });
		const body = await res.json();
		if (!res.ok) {
			error = body.error ?? 'Could not remove that address';
			return;
		}
		edited = body.addresses;
	}
</script>

<section class="surface-lg card">
	<h2><Icon name="at-line" size={18} /> Addresses</h2>
	<p class="card-hint">
		The From name is what recipients see. A signature on an address replaces the account signature
		for that mailbox. Leave either blank to use the account default.
	</p>

	<ul class="address-list">
		{#each addresses as address (address.id)}
			<li class="address-row">
				<div class="address-head">
					<div class="min-w-0 flex-1">
						<input
							type="text"
							class="name-input"
							value={address.label ?? ''}
							placeholder={t('settings.fromNamePlaceholder')}
							aria-label={t('settings.fromNameFor', { address: address.address })}
							disabled={savingId === address.id}
							onchange={(event) => saveLabel(address.id, event.currentTarget.value)}
						/>
						<p class="address-domain">{address.address}</p>
					</div>

					{#if address.is_default}
						<span class="badge">{t('common.default')}</span>
					{:else}
						<button type="button" class="btn-ghost text-xs" onclick={() => makeDefault(address.id)}>
							Make default
						</button>
					{/if}

					{#if addresses.length > 1}
						<button
							type="button"
							class="icon-btn"
							aria-label={t('settings.removeAddress', { address: address.address })}
							onclick={() => remove(address.id)}
						>
							<Icon name="delete-bin-line" size={15} />
						</button>
					{/if}
				</div>
				<textarea
					class="mailbox-signature"
					rows="2"
					maxlength={MAX_EMAIL_SIGNATURE_LENGTH}
					value={address.signature ?? ''}
					placeholder={t('settings.signaturePlaceholder')}
					aria-label={t('settings.mailboxSignature')}
					disabled={savingId === address.id}
					onchange={(event) => saveMailboxSignature(address.id, event.currentTarget.value)}
				></textarea>
			</li>
		{/each}
	</ul>

	<form class="add-form" onsubmit={addAddress}>
		<div class="add-field">
			<label class="field-title" for="new-display-name">{t('settings.fromName')}</label>
			<input
				id="new-display-name"
				type="text"
				bind:value={displayName}
				placeholder={t('settings.addressPlaceholder')}
				class="name-add-input"
				autocomplete="off"
			/>
			<AddressField
				bind:localPart
				bind:domainId
				{domains}
				placeholder="another"
				label={t('settings.addressLabel')}
			/>
		</div>
		<button type="submit" class="btn-primary" disabled={busy || !localPart.trim()}>
			{busy ? t('common.adding') : t('common.add')}
		</button>
	</form>

	{#if selectedDomain && !selectedDomain.receiving_enabled}
		<p class="hint">
			<Icon name="information-line" size={14} />
			{selectedDomain.name} can send, but inbound is off.
		</p>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}
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

	.address-list {
		margin-top: 1rem;
	}

	.address-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		padding: 0.75rem 0;
	}

	.address-row + .address-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.address-head {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.name-input {
		width: 100%;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		background: transparent;
		outline: none;
	}

	.name-input::placeholder {
		color: var(--color-muted);
		font-weight: 400;
	}

	.mailbox-signature {
		width: 100%;
		padding: 0.5rem 0.75rem;
		resize: vertical;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.mailbox-signature:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.mailbox-signature::placeholder {
		color: var(--color-muted);
	}

	.address-domain {
		margin-top: 0.125rem;
		font-size: 0.75rem;
		color: var(--color-muted);
	}

	.field-title {
		display: block;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.name-add-input {
		width: 100%;
		margin: 0.5rem 0 0.875rem;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.9375rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.name-add-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		background: var(--color-surface-muted);
	}

	.add-form {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.add-field {
		flex: 1;
		min-width: 0;
	}

	.hint {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin-top: 0.75rem;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.error {
		margin-top: 0.75rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	@media (max-width: 900px) {
		.card {
			margin-top: 1rem;
			padding: 1.25rem 1rem;
			box-shadow: none;
		}
	}
</style>
