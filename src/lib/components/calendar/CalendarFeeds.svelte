<script lang="ts">
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	import { DEFAULT_LOCALE } from '$lib/i18n/locales';
	import { formatRelativeDate } from '$lib/utils/date';
	import Icon from '../Icon.svelte';
	import { LABEL_COLORS, LABEL_SWATCH, type LabelColor } from '$lib/mail/labels';
	import { MAX_FEED_NAME_LENGTH, normalizeFeedUrl, type CalendarFeed } from '$lib/calendar/feeds';
	import { addFeed, fetchFeeds, removeFeed, syncFeed } from '$lib/calendar/client';

	/** Called after anything that changes which events exist, so the grid reloads. */
	let { onchange }: { onchange: () => void } = $props();

	let feeds = $state<CalendarFeed[]>([]);
	let loaded = $state(false);
	let adding = $state(false);
	let busyId = $state('');
	let removingId = $state('');
	let error = $state('');
	let name = $state('');
	let url = $state('');
	let color = $state<LabelColor>('blue');
	let submitting = $state(false);

	const locale = $derived($page.data.locale ?? DEFAULT_LOCALE);
	const urlLooksValid = $derived(normalizeFeedUrl(url) !== null);

	$effect(() => {
		fetchFeeds()
			.then((list) => (feeds = list))
			.catch((failure) => (error = failure instanceof Error ? failure.message : t('common.networkError')))
			.finally(() => (loaded = true));
	});

	function replace(feed: CalendarFeed) {
		feeds = feeds.some((entry) => entry.id === feed.id)
			? feeds.map((entry) => (entry.id === feed.id ? feed : entry))
			: [...feeds, feed];
	}

	async function run(id: string, action: () => Promise<void>) {
		if (busyId) return;
		busyId = id;
		error = '';
		try {
			await action();
			onchange();
		} catch (failure) {
			error = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			busyId = '';
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		submitting = true;
		error = '';
		try {
			replace(await addFeed({ name, url, color }));
			name = '';
			url = '';
			adding = false;
			onchange();
		} catch (failure) {
			error = failure instanceof Error ? failure.message : t('common.networkError');
		} finally {
			submitting = false;
		}
	}

	function status(feed: CalendarFeed): string {
		if (feed.lastError) return feed.lastError;
		if (!feed.lastSyncedAt) return t('calendar.feeds.neverSynced');
		return t('calendar.feeds.synced', {
			time: formatRelativeDate(feed.lastSyncedAt, locale),
			count: feed.eventCount
		});
	}
</script>

<section class="feeds surface-lg">
	<header class="feeds-head">
		<div>
			<h3>{t('calendar.feeds.heading')}</h3>
			<p class="feeds-hint">{t('calendar.feeds.hint')}</p>
		</div>
		{#if !adding}
			<button type="button" class="feeds-btn" onclick={() => (adding = true)}>
				<Icon name="add-line" size={16} />
				{t('calendar.feeds.add')}
			</button>
		{/if}
	</header>

	{#if error}<p class="feeds-error" role="alert">{error}</p>{/if}

	{#if adding}
		<form class="feeds-form" onsubmit={submit}>
			<label class="feeds-field">
				<span>{t('calendar.feeds.name')}</span>
				<input class="feeds-input" type="text" bind:value={name} maxlength={MAX_FEED_NAME_LENGTH} placeholder={t('calendar.feeds.namePlaceholder')} required />
			</label>
			<label class="feeds-field">
				<span>{t('calendar.feeds.url')}</span>
				<input class="feeds-input" type="url" bind:value={url} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off" spellcheck="false" required />
				<small>{t('calendar.feeds.urlHelp')}</small>
			</label>
			<fieldset class="feeds-field">
				<legend>{t('calendar.feeds.color')}</legend>
				<div class="feeds-swatches">
					{#each LABEL_COLORS as option (option)}
						<label class="feeds-swatch" style="--swatch: {LABEL_SWATCH[option]}" title={option}>
							<input type="radio" name="feed-color" value={option} bind:group={color} />
							<span></span>
						</label>
					{/each}
				</div>
			</fieldset>
			<div class="feeds-actions">
				<button type="button" class="btn-ghost" onclick={() => (adding = false)}>{t('common.cancel')}</button>
				<button type="submit" class="btn-primary" disabled={submitting || !urlLooksValid || !name.trim()}>
					{submitting ? t('calendar.feeds.adding') : t('calendar.feeds.subscribe')}
				</button>
			</div>
		</form>
	{/if}

	{#if loaded && feeds.length === 0 && !adding}
		<p class="feeds-empty">{t('calendar.feeds.empty')}</p>
	{:else if feeds.length > 0}
		<ul class="feeds-list">
			{#each feeds as feed (feed.id)}
				<li class="feeds-item">
					<span class="feeds-dot" style="background: {LABEL_SWATCH[feed.color]}"></span>
					<div class="feeds-info">
						<span class="feeds-name">{feed.name}</span>
						<span class="feeds-meta" class:failed={feed.lastError}>{feed.host} · {status(feed)}</span>
					</div>
					{#if removingId === feed.id}
						<button type="button" class="btn-ghost" onclick={() => (removingId = '')}>{t('common.cancel')}</button>
						<button
							type="button"
							class="feeds-btn feeds-danger"
							disabled={busyId === feed.id}
							onclick={() =>
								run(feed.id, async () => {
									await removeFeed(feed.id);
									feeds = feeds.filter((entry) => entry.id !== feed.id);
									removingId = '';
								})}
						>
							{t('calendar.feeds.remove')}
						</button>
					{:else}
						<button
							type="button"
							class="icon-btn"
							title={t('calendar.feeds.syncNow')}
							aria-label={t('calendar.feeds.syncNow')}
							disabled={busyId === feed.id}
							onclick={() => run(feed.id, async () => replace(await syncFeed(feed.id)))}
						>
							<Icon name="refresh-line" size={16} class={busyId === feed.id ? 'feeds-spin' : ''} />
						</button>
						<button
							type="button"
							class="icon-btn"
							title={t('calendar.feeds.remove')}
							aria-label={t('calendar.feeds.remove')}
							onclick={() => (removingId = feed.id)}
						>
							<Icon name="delete-bin-line" size={16} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.feeds {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
	}

	.feeds-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.feeds-hint,
	.feeds-empty,
	.feeds-field small {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.feeds-empty {
		color: var(--color-muted);
	}

	.feeds-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.feeds-btn {
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

	.feeds-danger {
		color: #fff;
		background: var(--color-danger);
		box-shadow: none;
	}

	.feeds-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.875rem;
		border-radius: 0.75rem;
		background: var(--color-surface-muted);
	}

	.feeds-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		border: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.feeds-input {
		padding: 0.5rem 0.75rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.feeds-input:focus {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.feeds-swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.feeds-swatch input {
		position: absolute;
		opacity: 0;
	}

	.feeds-swatch span {
		display: block;
		width: 1.375rem;
		height: 1.375rem;
		border-radius: 50%;
		background: var(--swatch);
		cursor: pointer;
	}

	.feeds-swatch input:checked + span {
		box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--swatch);
	}

	.feeds-swatch input:focus-visible + span {
		outline: 2px solid var(--color-focus-line);
		outline-offset: 4px;
	}

	.feeds-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.feeds-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.feeds-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0;
	}

	.feeds-item + .feeds-item {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.feeds-dot {
		flex-shrink: 0;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
	}

	.feeds-info {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.feeds-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.feeds-meta {
		overflow: hidden;
		font-size: 0.75rem;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-secondary);
	}

	.feeds-meta.failed {
		color: var(--color-danger);
	}

	.feeds :global(.feeds-spin) {
		animation: feeds-spin 0.8s linear infinite;
	}

	@keyframes feeds-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
