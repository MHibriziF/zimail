/**
 * The panes Zero's settings nav can show.
 *
 * Classic renders the whole page at once (`all`); Zero shows one at a time,
 * which is why this list is shared rather than living in either shell.
 * Upstream's list is `general | appearance | connections | notifications |
 * shortcuts`; this fork has no shortcuts sheet to configure but does have
 * security and cleanup, so it differs deliberately.
 */
export const SETTINGS_SECTIONS = [
	'general',
	'appearance',
	'security',
	'connections',
	'notifications',
	'cleanup',
	'labels'
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number] | 'all';

export function isSettingsSection(value: string | undefined): value is SettingsSection {
	return (SETTINGS_SECTIONS as readonly string[]).includes(value ?? '');
}
