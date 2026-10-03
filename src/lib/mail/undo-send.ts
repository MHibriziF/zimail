import { get, writable, type Readable } from 'svelte/store';

/** How long a sent message waits in the browser, so Undo can still take it back. */
export const UNDO_WINDOW_MS = 10_000;
const SENT_NOTICE_MS = 6_000;

export type OutgoingState =
	| { phase: 'holding' }
	| { phase: 'sending' }
	| { phase: 'sent'; viewHref: string | null }
	| { phase: 'failed' };

/** What a composer gets back after Undo, or after the send it handed over failed. */
export type Restored<T = unknown> = { key: string; snapshot: T; error: string | null };

export type HeldSend<T> = {
	/** Names the composer that sent it, so only that one takes the snapshot back. */
	key: string;
	snapshot: T;
	/** Delivers the message; resolves to where "View message" should go. */
	send: () => Promise<string | null>;
	/** Brings the composer back on screen. */
	reopen: () => void;
	describeError: (failure: unknown) => string;
};

const outgoingStore = writable<OutgoingState | null>(null);
const restoredStore = writable<Restored | null>(null);

export const outgoing: Readable<OutgoingState | null> = outgoingStore;
export const restored: Readable<Restored | null> = restoredStore;

let held: HeldSend<unknown> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight = 0;
let latestDispatch = 0;

/** Starts the undo window. A second send while one is still held sends the first at once. */
export function holdSend<T>(next: HeldSend<T>): void {
	if (held) void dispatch();
	held = next as HeldSend<unknown>;
	outgoingStore.set({ phase: 'holding' });
	clearTimeout(timer);
	timer = setTimeout(() => void dispatch(), UNDO_WINDOW_MS);
}

export function undoSend(): void {
	if (!held) return;
	clearTimeout(timer);
	const taken = held;
	held = null;
	outgoingStore.set(null);
	giveBack(taken, null);
}

/** Sends whatever is held now instead of waiting out the window. */
export function sendNow(): void {
	if (held) void dispatch();
}

/** True while closing the page would lose a message. */
export function isSendPending(): boolean {
	return held !== null || inFlight > 0;
}

/** Hands the snapshot to the composer named `key`, once. */
export function takeRestored<T>(key: string): Restored<T> | null {
	const current = get(restoredStore);
	if (current?.key !== key) return null;
	restoredStore.set(null);
	return current as Restored<T>;
}

export function dismissOutgoing(): void {
	if (held) return;
	clearTimeout(timer);
	outgoingStore.set(null);
}

async function dispatch(): Promise<void> {
	const sending = held;
	if (!sending) return;
	held = null;
	clearTimeout(timer);
	inFlight += 1;
	const turn = ++latestDispatch;
	outgoingStore.set({ phase: 'sending' });
	// Only the newest send speaks for the toast; an older one finishing late stays quiet.
	const report = (state: OutgoingState) => {
		if (turn !== latestDispatch || held) return;
		outgoingStore.set(state);
		timer = setTimeout(() => outgoingStore.set(null), SENT_NOTICE_MS);
	};
	try {
		report({ phase: 'sent', viewHref: await sending.send() });
	} catch (failure) {
		report({ phase: 'failed' });
		giveBack(sending, sending.describeError(failure));
	} finally {
		inFlight -= 1;
	}
}

function giveBack(taken: HeldSend<unknown>, error: string | null): void {
	restoredStore.set({ key: taken.key, snapshot: taken.snapshot, error });
	taken.reopen();
}
