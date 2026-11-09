<script lang="ts">
	import { page } from '$app/stores';
	import Icon from '../Icon.svelte';
	import { t } from '$lib/i18n';
	import { parseLocale } from '$lib/i18n/locales';
	import {
		EMOJI_CATEGORIES,
		EMOJI_LOCALES,
		emojiUpTo,
		newestSupportedVersion,
		rememberEmoji,
		searchEmoji,
		type Emoji,
		type EmojiCategory,
		type EmojiData,
		type EmojiDataLocale
	} from '$lib/utils/emoji';

	let {
		onpick,
		onclose
	}: {
		onpick: (char: string) => void;
		/** Escape: back to the message. A click elsewhere just closes it. */
		onclose: () => void;
	} = $props();

	const RECENT_KEY = 'zimail:recent-emoji';

	/** Each language is its own chunk, fetched the first time the picker opens. */
	const LOADERS: Record<EmojiDataLocale, () => Promise<{ default: EmojiData }>> = {
		en: () => import('virtual:emoji-data/en'),
		fr: () => import('virtual:emoji-data/fr'),
		es: () => import('virtual:emoji-data/es'),
		zh: () => import('virtual:emoji-data/zh')
	};

	type Tab = 'recent' | EmojiCategory;

	const TAB_ICONS: Record<Tab, string> = {
		recent: 'time-line',
		smileys: 'emotion-happy-line',
		people: 'user-smile-line',
		nature: 'leaf-line',
		food: 'cake-2-line',
		activities: 'football-line',
		travel: 'plane-line',
		objects: 'lightbulb-line',
		symbols: 'heart-3-line',
		flags: 'flag-line'
	};

	const TAB_LABELS: Record<Tab, string> = {
		recent: 'compose.emojiRecent',
		smileys: 'compose.emojiSmileys',
		people: 'compose.emojiPeople',
		nature: 'compose.emojiNature',
		food: 'compose.emojiFood',
		activities: 'compose.emojiActivities',
		travel: 'compose.emojiTravel',
		objects: 'compose.emojiObjects',
		symbols: 'compose.emojiSymbols',
		flags: 'compose.emojiFlags'
	};

	let popover = $state<HTMLDivElement | null>(null);
	let search = $state<HTMLInputElement | null>(null);
	let query = $state('');
	let recent = $state<string[]>([]);
	let tab = $state<Tab>('smileys');
	let emoji = $state<Emoji[] | null>(null);
	let loadedLocale: EmojiDataLocale | null = null;

	const locale = $derived(EMOJI_LOCALES[parseLocale(($page.data as { locale?: string }).locale)]);

	const tabs = $derived<Tab[]>(recent.length ? ['recent', ...EMOJI_CATEGORIES] : [...EMOJI_CATEGORIES]);

	const byCategory = $derived.by(() => {
		const groups = new Map<EmojiCategory, string[]>(EMOJI_CATEGORIES.map((category) => [category, []]));
		for (const item of emoji ?? []) groups.get(item.category)?.push(item.char);
		return groups;
	});

	const shown = $derived.by(() => {
		if (tab === 'recent' && !query.trim()) return recent;
		if (!emoji) return [];
		if (query.trim()) return searchEmoji(emoji, query, locale === 'zh').map((item) => item.char);
		return byCategory.get(tab as EmojiCategory) ?? [];
	});

	let canvas: HTMLCanvasElement | null = null;

	/** A drawn emoji has colour; a character the device lacks comes out as a plain box in the fill colour. */
	function draws(char: string): boolean {
		canvas ??= document.createElement('canvas');
		canvas.width = canvas.height = 24;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return false;
		context.fillStyle = '#000';
		context.textBaseline = 'top';
		context.font = '20px sans-serif';
		context.fillText(char, 0, 0);
		const pixels = context.getImageData(0, 0, 24, 24).data;
		for (let i = 0; i < pixels.length; i += 4) {
			if (pixels[i + 3] > 0 && (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2])) return true;
		}
		return false;
	}

	let loading: Promise<void> | null = null;

	/** Starts fetching the emoji, so they're usually there by the time the picker opens. */
	export function preload(): Promise<void> {
		if (emoji && loadedLocale === locale) return Promise.resolve();
		const wanted = locale;
		loading ??= LOADERS[wanted]()
			.then(({ default: data }) => {
				emoji = emojiUpTo(data, newestSupportedVersion(data.probes, draws));
				loadedLocale = wanted;
			})
			.catch(() => {
				// A failed chunk fetch (offline, mid-deploy) is retried the next time the picker opens.
			})
			.finally(() => {
				loading = null;
			});
		return loading;
	}

	function readRecent(): string[] {
		try {
			const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
			return Array.isArray(stored) ? stored.filter((item) => typeof item === 'string') : [];
		} catch {
			return [];
		}
	}

	function saveRecent(list: string[]) {
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(list));
		} catch {
			// Private windows can refuse storage; the picker still works without a recent list.
		}
	}

	/** Opens under `anchor`, kept on screen. */
	export function show(anchor: DOMRect) {
		if (!popover) return;
		void preload();
		recent = readRecent();
		tab = recent.length ? 'recent' : 'smileys';
		query = '';
		const width = Math.min(320, window.innerWidth - 16);
		const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
		const below = anchor.bottom + 6;
		const height = 320;
		const top = below + height > window.innerHeight ? Math.max(8, anchor.top - height - 6) : below;
		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
		popover.style.width = `${width}px`;
		popover.showPopover();
		search?.focus();
	}

	function hide() {
		if (popover?.matches(':popover-open')) popover.hidePopover();
	}

	function pick(char: string) {
		recent = rememberEmoji(recent, char);
		saveRecent(recent);
		hide();
		onpick(char);
	}

	/** Enter picks the first match and Escape closes, without either reaching the composer's form. */
	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			hide();
			onclose();
		} else if (event.key === 'Enter' && event.target === search) {
			event.preventDefault();
			event.stopPropagation();
			// Pressed before the emoji arrived: pick the first match for what was typed then, once they're in.
			const typed = query;
			void preload().then(() => {
				const first = typed.trim() && emoji ? searchEmoji(emoji, typed, locale === 'zh')[0]?.char : shown[0];
				if (first && popover?.matches(':popover-open')) pick(first);
			});
		}
	}
</script>

<div
	bind:this={popover}
	class="emoji-popover"
	popover="auto"
	role="dialog"
	aria-label={t('compose.emoji')}
	tabindex="-1"
	onkeydown={onKey}
>
	<input
		bind:this={search}
		bind:value={query}
		class="emoji-search"
		type="search"
		autocomplete="off"
		placeholder={t('compose.emojiSearch')}
		aria-label={t('compose.emojiSearch')}
	/>

	{#if !query.trim()}
		<div class="emoji-tabs" role="tablist">
			{#each tabs as item (item)}
				<button
					type="button"
					role="tab"
					class="emoji-tab"
					class:emoji-tab-active={tab === item}
					aria-selected={tab === item}
					title={t(TAB_LABELS[item])}
					aria-label={t(TAB_LABELS[item])}
					onclick={() => (tab = item)}
				>
					<Icon name={TAB_ICONS[item]} size={16} />
				</button>
			{/each}
		</div>
	{/if}

	<div class="emoji-grid">
		{#each shown as char (char)}
			<button type="button" class="emoji-cell" title={char} onclick={() => pick(char)}>{char}</button>
		{:else}
			{#if emoji}<p class="emoji-empty">{t('compose.emojiNone')}</p>{/if}
		{/each}
	</div>
</div>

<style>
	.emoji-popover {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0.5rem;
		border: none;
		border-radius: 0.75rem;
		color: var(--color-text);
		background: var(--color-surface);
		box-shadow: 0 0 0 1px var(--color-line), 0 12px 32px rgba(0, 0, 0, 0.18);
	}

	.emoji-popover:popover-open {
		display: grid;
		gap: 0.375rem;
	}

	.emoji-search {
		height: 2.125rem;
		padding: 0 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.emoji-search:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line, var(--color-accent));
	}

	.emoji-tabs {
		display: flex;
		justify-content: space-between;
	}

	.emoji-tab {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-muted);
	}

	.emoji-tab:hover,
	.emoji-tab-active {
		color: var(--color-text);
		background: var(--color-surface-muted);
	}

	.emoji-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(2.25rem, 1fr));
		height: 13.5rem;
		overflow-y: auto;
		align-content: start;
	}

	.emoji-cell {
		height: 2.25rem;
		border-radius: 0.5rem;
		font-size: 1.375rem;
		line-height: 1;
	}

	.emoji-cell:hover,
	.emoji-cell:focus-visible {
		background: var(--color-surface-muted);
	}

	.emoji-empty {
		grid-column: 1 / -1;
		padding: 1rem 0;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}
</style>
