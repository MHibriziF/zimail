import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isSettingsSection } from '$lib/settings-section';

export const load: PageServerLoad = async ({ params, locals }) => {
	// Classic has no sidebar to pick a pane from — it shows the whole page.
	if (locals.uiTheme === 'classic') {
		throw redirect(303, '/settings');
	}

	if (!isSettingsSection(params.section) || params.section === 'all') {
		throw error(404, 'Not found');
	}

	return { section: params.section };
};
