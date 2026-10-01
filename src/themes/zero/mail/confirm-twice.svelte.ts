const ARMED_FOR_MS = 4000;

/**
 * Asks twice before something that can't be undone, without a dialog: the first press arms the
 * button (it says so and turns solid), and a second press within a few seconds acts.
 */
export class ConfirmTwice {
	/** Which target is waiting for its second press, if any. */
	armed = $state<string | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;

	/** True when this press should act; otherwise it arms `key` and waits. */
	press(key: string): boolean {
		clearTimeout(this.#timer);
		if (this.armed === key) {
			this.armed = null;
			return true;
		}
		this.armed = key;
		this.#timer = setTimeout(() => (this.armed = null), ARMED_FOR_MS);
		return false;
	}
}
