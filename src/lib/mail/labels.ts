/**
 * Label rules shared by the server (which enforces them) and the UI (which
 * shows the same limits before a request is ever made).
 */

/** Stored by name, drawn from theme-aware CSS in `LabelChip.svelte`. */
export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

/** Mid-tone base per color; chips tint it, so one value reads in both light and dark. */
export const LABEL_SWATCH: Record<LabelColor, string> = {
	gray: '#71717a',
	red: '#dc2626',
	orange: '#ea580c',
	yellow: '#ca8a04',
	green: '#16a34a',
	teal: '#0d9488',
	blue: '#2563eb',
	purple: '#9333ea'
};

export const MAX_LABEL_NAME_LENGTH = 40;
export const MAX_LABELS_PER_USER = 100;

export type Label = {
	id: string;
	name: string;
	color: LabelColor;
};

export function parseLabelColor(value: unknown): LabelColor | undefined {
	return LABEL_COLORS.find((color) => color === value);
}

/** `null` when nothing is left once whitespace is trimmed and collapsed. */
export function normalizeLabelName(input: string): string | null {
	const name = input.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_NAME_LENGTH).trim();
	return name || null;
}
