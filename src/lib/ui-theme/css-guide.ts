import { CHOICES } from './appearance';

/**
 * What the custom CSS guide documents. Kept next to the appearance code so a renamed token or a
 * new setting is one place to update; the attributes come straight from CHOICES.
 */

export type GuideVariable = { name: string; key: string; only?: 'zero' | 'classic' };

/** Tokens the themes read; overriding one changes everything built on it. */
export const GUIDE_VARIABLES: GuideVariable[] = [
	{ name: '--color-accent', key: 'accent' },
	{ name: '--color-bg', key: 'bg' },
	{ name: '--color-surface', key: 'surface' },
	{ name: '--color-surface-muted', key: 'surfaceMuted' },
	{ name: '--color-text', key: 'text' },
	{ name: '--color-text-secondary', key: 'textSecondary' },
	{ name: '--color-line', key: 'line' },
	{ name: '--color-danger', key: 'danger' },
	{ name: '--radius-scale', key: 'radiusScale' },
	{ name: '--font-sans', key: 'font' },
	{ name: '--sidebar-width', key: 'sidebarWidth', only: 'classic' },
	{ name: '--z-sidebar', key: 'zSidebar', only: 'zero' },
	{ name: '--z-panel', key: 'zPanel', only: 'zero' },
	{ name: '--z-hover', key: 'zHover', only: 'zero' },
	{ name: '--z-sidebar-width', key: 'zSidebarWidth', only: 'zero' }
];

/** `data-part` hooks: named on purpose and kept stable, unlike class names. */
export const GUIDE_PARTS = [
	{ name: 'sidebar', key: 'sidebar' },
	{ name: 'compose', key: 'compose' },
	{ name: 'ask-ai', key: 'askAi' }
];

/** `<html>` attributes and their values, the Personalise choices first-hand from CHOICES. */
export const GUIDE_ATTRIBUTES: { name: string; values: readonly string[] }[] = [
	{ name: 'data-ui-theme', values: ['zero', 'classic'] },
	{ name: 'data-theme', values: ['light', 'dark'] },
	...Object.values(CHOICES).map((choice) => ({
		name: `data-${choice.attribute.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
		values: choice.options.slice(1)
	}))
];

export const GUIDE_CLASSES: Record<'zero' | 'classic', string[]> = {
	zero: [
		'.z-list',
		'.z-row',
		'.z-row-name',
		'.z-row-subject',
		'.z-row-preview',
		'.z-unread-dot',
		'.z-thread-subject',
		'.z-msg-body',
		'.z-composer',
		'.z-mobile-nav'
	],
	classic: ['.row', '.row-link .subject', '.row-link .preview', '.stack-header']
};

export type GuideExample = { id: string; css: string };

export const GUIDE_EXAMPLES: GuideExample[] = [
	{
		id: 'oled',
		css: `/* Pure black in dark mode */
:root[data-ui-theme][data-theme='dark'] {
	--color-bg: #000000;
	--color-surface: #000000;
	--z-sidebar: #000000;
	--z-panel: #000000;
	--z-bg: #000000;
}`
	},
	{
		id: 'unread',
		css: `/* Tint unread conversations with the accent */
[data-ui-theme='zero'] .z-row:has(.z-unread-dot) {
	background: color-mix(in oklch, var(--color-accent) 14%, transparent);
}`
	},
	{
		id: 'subject',
		css: `/* A bigger subject at the top of a conversation */
[data-ui-theme='zero'] .z-thread-subject {
	font-size: 1.625rem;
	letter-spacing: -0.02em;
}`
	},
	{
		id: 'width',
		css: `/* Keep long messages to a comfortable reading width */
[data-ui-theme='zero'] .z-msg-body {
	max-width: 44rem;
}`
	},
	{
		id: 'hideAsk',
		css: `/* Hide the Ask AI button */
[data-part='ask-ai'] {
	display: none !important;
}`
	},
	{
		id: 'compose',
		css: `/* An outlined Compose button */
[data-ui-theme] [data-part='compose'] {
	background: transparent;
	color: var(--color-text);
	box-shadow: inset 0 0 0 1.5px var(--color-accent);
}`
	},
	{
		id: 'font',
		css: `@import url('https://fonts.bunny.net/css?family=inter:400,500,600');

/* Inter for the whole interface */
:root[data-ui-theme] {
	--font-sans: 'Inter', sans-serif;
	--font-geist-sans: 'Inter', sans-serif;
}`
	}
];

/**
 * Adds an example to the user's CSS. `@import` only works before every other rule, so imports
 * go to the top and the rest to the end.
 */
export function addExample(current: string, example: string): string {
	const lines = example.split('\n');
	const imports = lines.filter((line) => line.trim().startsWith('@import'));
	const rest = lines.filter((line) => !line.trim().startsWith('@import')).join('\n').trim();
	const parts = [imports.join('\n'), current.trim(), rest].filter(Boolean);
	return parts.join('\n\n');
}
