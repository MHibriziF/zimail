import type { Component, Snippet } from 'svelte';
import type { Domain, MailAddress, MailboxCounts, MailboxView, User } from '$lib/types';
import type { Label } from '$lib/mail/labels';
import type { CalendarEvent } from '$lib/calendar/events';

/** What a theme's shell can do, so a route can ask before assuming. */
export type ThemeCapabilities = {
	twoPane: boolean;
	composeOverlay: boolean;
	commandPalette: boolean;
	shortcuts: boolean;
	folders: readonly MailboxView[];
};

export type ThemeShellData = {
	user: User;
	domains: Domain[];
	addresses: MailAddress[];
	activeDomainId: string | null;
	counts: MailboxCounts;
	/** User labels, for the sidebar. */
	labels: Label[];
	/** Today's and tomorrow's events, for the sidebar. */
	upcoming: CalendarEvent[];
	uiTheme: string;
};

export type ThemeShellProps = {
	data: ThemeShellData;
	children: Snippet;
};

export type ThemeModule = {
	id: string;
	name: string;
	version: string;
	engine: string;
	capabilities: ThemeCapabilities;
	Shell: Component<ThemeShellProps>;
};
