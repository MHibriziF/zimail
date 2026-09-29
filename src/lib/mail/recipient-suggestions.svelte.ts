/**
 * The typeahead behind every address field — compose recipients and calendar
 * guests: asks `/api/recipients` as the user types and tracks the highlighted
 * suggestion. Chips and markup stay with each field.
 */
export class RecipientSuggestions {
	items = $state<string[]>([]);
	active = $state(-1);
	open = $state(false);
	private seq = 0;

	/** Looks up `term`, leaving out addresses already chosen (compared case-insensitively). */
	async search(term: string, taken: readonly string[]) {
		const mine = ++this.seq;
		if (!term.trim()) {
			this.close();
			return;
		}

		try {
			const res = await fetch(`/api/recipients?q=${encodeURIComponent(term)}`);
			if (!res.ok) return;
			const body = (await res.json()) as { suggestions?: Array<{ address: string }> };
			// A slower earlier request must not overwrite a newer one's results.
			if (mine !== this.seq) return;

			const skip = new Set(taken.map((address) => address.toLowerCase()));
			this.items = (body.suggestions ?? [])
				.map((entry) => entry.address)
				.filter((address) => !skip.has(address.toLowerCase()));
			this.active = -1;
			this.open = this.items.length > 0;
		} catch {
			// Typeahead is a convenience; typing still works without it.
		}
	}

	/** Moves the highlight for ArrowUp/ArrowDown; `true` if the key was used. */
	move(key: string): boolean {
		if (!this.open || (key !== 'ArrowDown' && key !== 'ArrowUp')) return false;
		const step = key === 'ArrowDown' ? 1 : -1;
		this.active = (this.active + step + this.items.length) % this.items.length;
		return true;
	}

	get highlighted(): string | null {
		return this.active >= 0 ? (this.items[this.active] ?? null) : null;
	}

	/** Hides the list but keeps it, so typing on brings it straight back. */
	hide() {
		this.open = false;
	}

	/** Clears the list, and drops any lookup still in flight. */
	close() {
		this.seq++;
		this.items = [];
		this.active = -1;
		this.open = false;
	}
}
