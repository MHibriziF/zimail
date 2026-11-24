<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { participantName } from '$lib/mail/folders';
	import { formatRelativeDate } from '$lib/utils/date';
	import { t } from '$lib/i18n';
	import type { MailboxPage, ThreadSummary } from '$lib/types';
	import Icon from '../icons/Icon.svelte';

	let { onClose }: { onClose: () => void } = $props();

	type NavItem = { kind: 'nav'; href: string; icon: string; label: string };
	type SearchItem = { kind: 'search'; query: string };
	type ResultItem = { kind: 'thread'; thread: ThreadSummary };
	type Item = NavItem | SearchItem | ResultItem;

	const nav = $derived<NavItem[]>([
		{ kind: 'nav', href: '/inbox?compose=1', icon: 'PencilCompose', label: t('nav.compose') },
		{ kind: 'nav', href: '/inbox', icon: 'Inbox', label: t('nav.inbox') },
		{ kind: 'nav', href: '/drafts', icon: 'Folder', label: t('nav.drafts') },
		{ kind: 'nav', href: '/sent', icon: 'Plane2', label: t('nav.sent') },
		{ kind: 'nav', href: '/archive', icon: 'Archive', label: t('nav.archive') },
		{ kind: 'nav', href: '/trash', icon: 'Bin', label: t('nav.bin') },
		{ kind: 'nav', href: '/starred', icon: 'Star2', label: t('nav.starred') },
		{ kind: 'nav', href: '/settings/general', icon: 'SettingsGear', label: t('nav.settings') }
	]);

	/** Results come from every folder but the bin and spam, like All Mail. */
	const SEARCH_FOLDER = 'all';
	const MAX_HITS = 8;

	let query = $state('');
	let active = $state(0);
	let results = $state<ThreadSummary[]>([]);
	/** idle: under two characters; searching / done / failed: the request for the current text. */
	let status = $state<'idle' | 'searching' | 'done' | 'failed'>('idle');
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		inputEl?.focus();
	});

	$effect(() => {
		const q = query.trim();
		if (q.length < 2) {
			results = [];
			status = 'idle';
			return;
		}
		let cancelled = false;
		status = 'searching';
		const handle = window.setTimeout(() => {
			void fetch(`/api/mail/list?folder=${SEARCH_FOLDER}&q=${encodeURIComponent(q)}`)
				.then(async (response) => {
					if (!response.ok) throw new Error(String(response.status));
					const body = (await response.json()) as { mailbox?: MailboxPage };
					if (cancelled) return;
					results = (body.mailbox?.threads ?? []).slice(0, MAX_HITS);
					status = 'done';
				})
				.catch(() => {
					if (cancelled) return;
					results = [];
					status = 'failed';
				});
		}, 180);
		return () => {
			cancelled = true;
			window.clearTimeout(handle);
		};
	});

	const term = $derived(query.trim());
	const navHits = $derived(term ? nav.filter((item) => item.label.toLowerCase().includes(term.toLowerCase())) : nav);
	const searchItem = $derived<SearchItem | null>(term.length >= 2 ? { kind: 'search', query: term } : null);
	const threadHits = $derived<ResultItem[]>(results.map((thread) => ({ kind: 'thread', thread })));

	/** In the order they are drawn and stepped through: the full search first, then places, then messages. */
	const items = $derived<Item[]>([...(searchItem ? [searchItem] : []), ...navHits, ...threadHits]);

	$effect(() => {
		if (active >= items.length) active = 0;
	});

	const optionId = (index: number) => `z-palette-option-${index}`;
	const indexOf = (item: Item) => items.indexOf(item);

	function threadHref(thread: ThreadSummary): string {
		if (thread.is_draft) return `/drafts?compose=1&draft=${encodeURIComponent(thread.latest_id)}`;
		return `/${SEARCH_FOLDER}?thread=${encodeURIComponent(thread.latest_id)}`;
	}

	function run(item: Item) {
		if (item.kind === 'nav') void goto(item.href);
		else if (item.kind === 'search') void goto(`/${SEARCH_FOLDER}?q=${encodeURIComponent(item.query)}`);
		else void goto(threadHref(item.thread));
		onClose();
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (items.length === 0) return;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + items.length) % items.length;
			document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const item = items[active];
			if (item) run(item);
		}
	}

	const sender = (thread: ThreadSummary) => participantName(thread.participants, 'all', $page.data.locale);
	const when = (thread: ThreadSummary) =>
		formatRelativeDate(thread.created_at, $page.data.locale, $page.data.timeZone ?? undefined);
	const placeOf = (thread: ThreadSummary) => {
		if (thread.is_draft) return t('nav.drafts');
		if (thread.is_archived) return t('nav.archive');
		return '';
	};
</script>

<div
	class="z-palette-scrim"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose();
	}}
>
	<div class="z-palette" role="dialog" aria-modal="true" aria-label={t('search.title')} tabindex="-1" onkeydown={onKey}>
		<input
			bind:this={inputEl}
			bind:value={query}
			placeholder={t('search.placeholder')}
			role="combobox"
			aria-label={t('search.title')}
			aria-expanded={items.length > 0}
			aria-controls="z-palette-list"
			aria-autocomplete="list"
			aria-activedescendant={items.length > 0 ? optionId(active) : undefined}
		/>
		<div class="z-palette-list" id="z-palette-list" role="listbox" aria-label={t('search.title')}>
			{#if searchItem}
				{@const index = indexOf(searchItem)}
				<!-- Keys act on the input, a combobox whose active option this is (aria-activedescendant). -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					id={optionId(index)}
					class="z-palette-item"
					class:active={index === active}
					role="option"
					tabindex="-1"
					aria-selected={index === active}
					onmouseenter={() => (active = index)}
					onclick={() => run(searchItem)}
				>
					<Icon name="Search" />
					<span class="z-palette-main">{t('search.allFor', { query: searchItem.query })}</span>
					<kbd class="z-palette-enter">↵</kbd>
				</div>
			{/if}

			{#if navHits.length > 0}
				<div role="group" aria-labelledby="z-palette-goto">
					<div class="z-palette-heading" id="z-palette-goto" role="presentation">{t('search.goTo')}</div>
					{#each navHits as item (item.href)}
						{@const index = indexOf(item)}
						<!-- Keys act on the input, a combobox whose active option this is (aria-activedescendant). -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id={optionId(index)}
							class="z-palette-item"
							class:active={index === active}
							role="option"
							tabindex="-1"
							aria-selected={index === active}
							onmouseenter={() => (active = index)}
							onclick={() => run(item)}
						>
							<Icon name={item.icon} />
							<span class="z-palette-main">{item.label}</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if threadHits.length > 0}
				<div role="group" aria-labelledby="z-palette-messages">
					<div class="z-palette-heading" id="z-palette-messages" role="presentation">{t('search.messages')}</div>
					{#each threadHits as item (item.thread.thread_id)}
						{@const index = indexOf(item)}
						{@const place = placeOf(item.thread)}
						<!-- Keys act on the input, a combobox whose active option this is (aria-activedescendant). -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							id={optionId(index)}
							class="z-palette-item z-palette-hit"
							class:active={index === active}
							role="option"
							tabindex="-1"
							aria-selected={index === active}
							onmouseenter={() => (active = index)}
							onclick={() => run(item)}
						>
							<Icon name="Mail" />
							<span class="z-palette-main">
								<span class="z-palette-line">
									<span class="z-palette-who">{sender(item.thread)}</span>
									<span class="z-palette-subject">{item.thread.subject || t('mailbox.noSubject')}</span>
								</span>
								{#if item.thread.preview}
									<span class="z-palette-snippet">{item.thread.preview}</span>
								{/if}
							</span>
							<span class="z-palette-meta">
								{#if place}<span class="z-palette-place">{place}</span>{/if}
								<span>{when(item.thread)}</span>
							</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if term.length < 2 && navHits.length === 0}
				<p class="z-palette-note">{t('search.typeToSearch')}</p>
			{:else if status === 'searching' && threadHits.length === 0}
				<p class="z-palette-note" role="status">{t('search.searching')}</p>
			{:else if status === 'failed'}
				<p class="z-palette-note failed" role="status">{t('search.failed')}</p>
			{:else if status === 'done' && threadHits.length === 0}
				<p class="z-palette-note" role="status">{t('search.noMatches')}</p>
			{/if}
		</div>
	</div>
</div>
