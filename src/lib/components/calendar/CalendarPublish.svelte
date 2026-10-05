<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '../Icon.svelte';
	import type { PublishStatus } from '$lib/calendar/publish';
	import { fetchPublishStatus, publishCalendar, savePublishOptions, unpublishCalendar } from '$lib/calendar/client';

	let status = $state<PublishStatus | null>(null);
	/** Only known right after creating or resetting: the server keeps just its hash. */
	let link = $state('');
	let copied = $state(false);
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		fetchPublishStatus()
			.then((loaded) => (status = loaded))
			.catch((failure) => (error = failure instanceof Error ? failure.message : t('common.networkError')));
	});

	async function run(action: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await action();
		} catch (failure) {
			error = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			busy = false;
		}
	}

	const createLink = () =>
		run(async () => {
			const result = await publishCalendar();
			status = result.status;
			link = result.url;
			copied = false;
		});

	const setOption = (option: 'includeFeeds' | 'busyOnly', value: boolean) =>
		run(async () => {
			if (!status?.published) return;
			status = await savePublishOptions({ includeFeeds: status.includeFeeds, busyOnly: status.busyOnly, [option]: value });
		});

	const stop = () =>
		run(async () => {
			await unpublishCalendar();
			status = { published: false };
			link = '';
		});

	async function copy() {
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 1600);
		} catch {
			/* clipboard unavailable — the box is still selectable */
		}
	}
</script>

<section class="publish surface-lg">
	<header>
		<h3>{t('calendar.publish.heading')}</h3>
		<p class="publish-hint">{t('calendar.publish.hint')}</p>
	</header>

	{#if error}<p class="publish-error" role="alert">{error}</p>{/if}

	{#if status && !status.published}
		<div>
			<button type="button" class="publish-btn" disabled={busy} onclick={createLink}>
				<Icon name="links-line" size={16} />
				{t('calendar.publish.create')}
			</button>
		</div>
	{:else if status?.published}
		{#if link}
			<div class="publish-link">
				<label class="publish-field">
					<span>{t('calendar.publish.linkLabel')}</span>
					<input class="publish-input" type="text" readonly value={link} onfocus={(event) => event.currentTarget.select()} />
				</label>
				<button type="button" class="publish-btn" onclick={copy}>
					<Icon name={copied ? 'check-line' : 'file-copy-line'} size={16} />
					{copied ? t('calendar.publish.copied') : t('calendar.publish.copy')}
				</button>
			</div>
			<p class="publish-hint">{t('calendar.publish.linkOnce')}</p>
			<p class="publish-hint">{t('calendar.publish.howTo')}</p>
		{:else}
			<p class="publish-hint">{t('calendar.publish.published')}</p>
		{/if}

		<label class="publish-option">
			<input
				type="checkbox"
				checked={status.includeFeeds}
				disabled={busy}
				onchange={(event) => setOption('includeFeeds', event.currentTarget.checked)}
			/>
			<span>{t('calendar.publish.includeFeeds')}</span>
		</label>
		<label class="publish-option">
			<input
				type="checkbox"
				checked={status.busyOnly}
				disabled={busy}
				onchange={(event) => setOption('busyOnly', event.currentTarget.checked)}
			/>
			<span>{t('calendar.publish.busyOnly')}</span>
		</label>

		<div class="publish-actions">
			<button type="button" class="publish-btn" disabled={busy} onclick={createLink} title={t('calendar.publish.resetHint')}>
				<Icon name="refresh-line" size={16} />
				{t('calendar.publish.reset')}
			</button>
			<button type="button" class="btn-ghost" disabled={busy} onclick={stop}>{t('calendar.publish.stop')}</button>
		</div>
	{/if}
</section>

<style>
	.publish {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
	}

	h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.publish-hint {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.publish-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.publish-btn {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4375rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.8125rem;
		font-weight: 500;
		white-space: nowrap;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-focus-line);
	}

	.publish-link {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
	}

	.publish-field {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.publish-input {
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.publish-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.publish-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
