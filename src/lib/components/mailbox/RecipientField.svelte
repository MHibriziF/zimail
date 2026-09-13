<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';

	/**
	 * Recipient entry as chips.
	 *
	 * `value` stays the comma-joined string the drafts table and the send API
	 * already expect, so nothing downstream changes — the chips are purely how
	 * the field is edited. Space commits a token because an email address can
	 * never contain one.
	 */
	let {
		value = $bindable(''),
		label,
		placeholder = '',
		id,
		required = false,
		/**
		 * Which shell is rendering this. The chips and the suggestion list are
		 * the same either way; only the row and label chrome differ, so the
		 * field can sit in Zero's composer without dragging Classic's in.
		 */
		shell = 'classic',
		trailing
	}: {
		value: string;
		label: string;
		placeholder?: string;
		id: string;
		required?: boolean;
		shell?: 'classic' | 'zero';
		/** Rendered at the end of the row — the Cc/Bcc toggle lives here. */
		trailing?: Snippet;
	} = $props();

	const rowClass = $derived(shell === 'zero' ? 'z-composer-row' : 'field-row recipients');
	const labelClass = $derived(shell === 'zero' ? 'z-composer-label' : 'field-label');

	const SEPARATORS = [' ', ',', ';', 'Enter', 'Tab'];

	let draft = $state('');
	let suggestions = $state<string[]>([]);
	let active = $state(-1);
	let open = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let seq = 0;

	// The string is the source of truth; chips are derived from it so an outside
	// change (loading a draft, hitting reply) shows up without extra wiring.
	const chips = $derived(
		value
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
	);

	function write(next: string[]) {
		value = next.join(', ');
	}

	function add(address: string) {
		const clean = address.trim().replace(/[,;]+$/, '');
		if (!clean) return;
		// Case-insensitive de-dupe, keeping whichever spelling arrived first.
		if (!chips.some((chip) => chip.toLowerCase() === clean.toLowerCase())) {
			write([...chips, clean]);
		}
		draft = '';
		suggestions = [];
		active = -1;
		open = false;
	}

	function remove(index: number) {
		write(chips.filter((_, i) => i !== index));
	}

	async function search(term: string) {
		const mine = ++seq;
		if (!term.trim()) {
			suggestions = [];
			open = false;
			return;
		}

		try {
			const res = await fetch(`/api/recipients?q=${encodeURIComponent(term)}`);
			if (!res.ok) return;
			const body = (await res.json()) as { suggestions?: Array<{ address: string }> };
			// A slower earlier request must not overwrite a newer one's results.
			if (mine !== seq) return;

			const taken = new Set(chips.map((chip) => chip.toLowerCase()));
			suggestions = (body.suggestions ?? [])
				.map((entry) => entry.address)
				.filter((address) => !taken.has(address.toLowerCase()));
			active = -1;
			open = suggestions.length > 0;
		} catch {
			// Typeahead is a convenience; typing still works without it.
		}
	}

	function onInput(event: Event) {
		const el = event.currentTarget as HTMLInputElement;
		// Pasting a list should break straight into chips.
		if (/[,;]/.test(el.value)) {
			const parts = el.value.split(/[,;]+/);
			const tail = parts.pop() ?? '';
			parts.forEach(add);
			draft = tail;
		} else {
			draft = el.value;
		}
		void search(draft);
	}

	function onKeydown(event: KeyboardEvent) {
		if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
			event.preventDefault();
			const step = event.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + suggestions.length) % suggestions.length;
			return;
		}

		if (event.key === 'Escape' && open) {
			event.preventDefault();
			open = false;
			return;
		}

		if (SEPARATORS.includes(event.key)) {
			// Tab only commits when there is something to commit, so it still moves
			// focus on an empty field.
			if (event.key === 'Tab' && !draft.trim() && active < 0) return;
			event.preventDefault();
			add(active >= 0 ? suggestions[active] : draft);
			return;
		}

		if (event.key === 'Backspace' && !draft && chips.length) {
			event.preventDefault();
			// Pull it back for editing rather than destroying it outright.
			draft = chips[chips.length - 1];
			write(chips.slice(0, -1));
		}
	}

	function onBlur() {
		// Let a click on a suggestion land before the list disappears.
		setTimeout(() => {
			if (draft.trim()) add(draft);
			open = false;
		}, 120);
	}
</script>

<div class={rowClass} class:recipients={true}>
	<span class={labelClass} id={`${id}-label`}>{label}</span>

	<div class="entry">
		{#each chips as chip, index (chip)}
			<span class="chip">
				<span class="chip-text">{chip}</span>
				<button
					type="button"
					class="chip-x"
					aria-label={t('compose.removeRecipient', { address: chip })}
					onclick={() => remove(index)}
				>
					<Icon name="close-line" size={12} />
				</button>
			</span>
		{/each}

		<input
			{id}
			bind:this={inputEl}
			type="text"
			class="field-input entry-input"
			value={draft}
			placeholder={chips.length ? '' : placeholder}
			required={required && chips.length === 0}
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
			role="combobox"
			aria-expanded={open}
			aria-controls={`${id}-listbox`}
			aria-labelledby={`${id}-label`}
			oninput={onInput}
			onkeydown={onKeydown}
			onblur={onBlur}
		/>

		{#if open}
			<ul class="suggestions" id={`${id}-listbox`} role="listbox">
				{#each suggestions as suggestion, index (suggestion)}
					<li role="none">
						<button
							type="button"
							role="option"
							aria-selected={index === active}
							class="suggestion"
							class:on={index === active}
							onmousedown={(event) => {
								event.preventDefault();
								add(suggestion);
								inputEl?.focus();
							}}
						>
							{suggestion}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if trailing}
		<div class="trailing">{@render trailing()}</div>
	{/if}
</div>

<style>
	.recipients {
		align-items: flex-start;
		position: relative;
	}

	.field-label {
		padding-top: 0.9rem;
	}

	.entry {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		width: 100%;
		min-height: 3rem;
		padding: 0.5rem 0;
		position: relative;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		max-width: 100%;
		padding: 0.125rem 0.25rem 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
	}

	.chip-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-x {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 9999px;
		color: var(--color-muted);
		transition:
			color 0.12s,
			background 0.12s;
	}

	.chip-x:hover {
		color: var(--color-text);
		background: var(--color-surface-hover);
	}

	.chip-x:focus-visible {
		outline: 2px solid var(--color-focus-line);
		outline-offset: 1px;
	}

	.entry-input {
		flex: 1 1 8rem;
		width: auto;
		min-width: 8rem;
		padding: 0.125rem 0;
	}

	.suggestions {
		position: absolute;
		top: calc(100% - 0.25rem);
		left: 0;
		z-index: 20;
		width: min(22rem, 100%);
		max-height: 14rem;
		overflow-y: auto;
		padding: 0.25rem;
		border-radius: 0.75rem;
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}

	.suggestion {
		display: block;
		width: 100%;
		padding: 0.5rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		text-align: left;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.suggestion:hover,
	.suggestion.on {
		background: var(--color-surface-muted);
	}

	.trailing {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		min-height: 3rem;
	}
</style>
