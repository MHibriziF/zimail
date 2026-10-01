import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { GITHUB_REPO, INSTALL_SCRIPT_URL } from '../constants';

// Every place that tells someone how to install the CLI. The fork shares no history with
// upstream, so a copied line keeps installing upstream's version until someone notices.
const INSTALL_SOURCES = [
	'src/lib/components/settings/ApiKeysPanel.svelte',
	'src/routes/install.sh/+server.ts',
	'cli/main.ts',
	'scripts/install.sh',
	'README.md'
];

test("install instructions fetch this fork's installer, not upstream's", () => {
	assert.equal(INSTALL_SCRIPT_URL, `https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh`);
	for (const path of INSTALL_SOURCES) {
		const source = readFileSync(path, 'utf8');
		assert.ok(!source.includes('raw.githubusercontent.com/DivinPrince/'), `${path} still installs from upstream`);
		assert.ok(!source.includes("GITHUB_REPO = 'DivinPrince"), `${path} still points at upstream`);
	}
});
